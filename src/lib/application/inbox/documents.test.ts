import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
	routeInboxDocument,
	analyzeInboxDocument,
	uploadInboxDocument,
	InboxDocumentNotAvailableError
} from './documents';
import type { InboxRepositoryPort } from '../ports';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PDF_SHA256 = createHash('sha256').update(PDF).digest('hex');
function ports() {
	return {
		inbox: {
			insert: vi.fn((x) => x),
			claimForRouting: vi.fn<InboxRepositoryPort['claimForRouting']>(() => ({
				id: 'doc',
				storageKey: 'ab/doc',
				filename: 'a.pdf',
				mimeType: 'application/pdf',
				byteSize: PDF.byteLength,
				sha256: PDF_SHA256,
				suggestion: null,
				status: 'ROUTING',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z'
			})),
			deleteClaimed: vi.fn(() => true),
			releaseRouting: vi.fn(),
			recoverInterruptedRouting: vi.fn(),
			completeRouting: vi.fn<InboxRepositoryPort['completeRouting']>((input) => ({
				itemId: input.destination.kind === 'EXISTING' ? input.destination.itemId : 'new-item',
				attachmentId: input.attachment.id
			})),
			deletePending: vi.fn(),
			listPending: vi.fn(),
			getById: vi.fn(),
			updateSuggestion: vi.fn(() => true)
		},
		storage: {
			store: vi.fn(() => 'ab/doc'),
			readBytes: vi.fn(() => PDF),
			remove: vi.fn(),
			sha256: vi.fn(() => PDF_SHA256)
		},
		attachmentStorage: {
			store: vi.fn(() => 'cd/att'),
			remove: vi.fn(),
			sha256: vi.fn(() => 'b'.repeat(64)),
			readBytes: vi.fn(),
			openReadStream: vi.fn()
		},
		items: {
			getItemById: vi.fn(() => ({ id: 'item' })),
			createItem: vi.fn(),
			listItems: vi.fn(() => []),
			setItemStatus: vi.fn()
		},
		cycles: { getActiveCycle: vi.fn(() => null) },
		attachments: { countByItem: vi.fn(() => 0), insert: vi.fn((x) => x) },
		playbooks: { findById: vi.fn(), list: vi.fn() },
		settings: { get: vi.fn((key: string) => (key === 'ai.enabled' ? '1' : null)), set: vi.fn() },
		runs: { claimRun: vi.fn(), markSucceeded: vi.fn(), markFailed: vi.fn() },
		ids: { newId: vi.fn(() => 'att') },
		clock: { nowIso: vi.fn(() => '2026-01-01T00:00:00.000Z') }
	};
}
describe('inbox documents', () => {
	it('stores a durable pending file before its row', () => {
		const p = ports();
		const order: string[] = [];
		p.storage.store.mockImplementation(() => {
			order.push('file');
			return 'ab/doc';
		});
		p.inbox.insert.mockImplementation((x) => {
			order.push('row');
			return x;
		});
		uploadInboxDocument(p as never, { filename: 'a.pdf', bytes: PDF });
		expect(order).toEqual(['file', 'row']);
	});
	it('allows only one concurrent confirmation and preserves the pending file on failure', () => {
		const p = ports();
		p.inbox.claimForRouting.mockReturnValueOnce(null);
		expect(() =>
			routeInboxDocument(p as never, { documentId: 'doc', destination: 'EXISTING', itemId: 'item' })
		).toThrow(InboxDocumentNotAvailableError);
		expect(p.storage.remove).not.toHaveBeenCalled();
	});
	it('commits attachment metadata and pending deletion through one routing operation', () => {
		const p = ports();
		routeInboxDocument(p as never, { documentId: 'doc', destination: 'EXISTING', itemId: 'item' });
		expect(p.inbox.completeRouting).toHaveBeenCalledWith(
			expect.objectContaining({
				documentId: 'doc',
				destination: { kind: 'EXISTING', itemId: 'item' },
				attachment: expect.objectContaining({ storageKey: 'cd/att' })
			})
		);
		expect(p.inbox.deleteClaimed).not.toHaveBeenCalled();
	});
	it('releases the claim, retains pending bytes, and removes the destination file when atomic completion fails', () => {
		const p = ports();
		p.inbox.completeRouting.mockImplementation(() => {
			throw new Error('db failed');
		});
		expect(() =>
			routeInboxDocument(p as never, { documentId: 'doc', destination: 'EXISTING', itemId: 'item' })
		).toThrow('db failed');
		expect(p.inbox.releaseRouting).toHaveBeenCalledWith('doc', '2026-01-01T00:00:00.000Z');
		expect(p.storage.remove).not.toHaveBeenCalled();
		expect(p.attachmentStorage.remove).toHaveBeenCalledWith('cd/att');
	});
	it('cleans up the destination and re-opens the pending document when completion loses its claim', () => {
		const p = ports();
		p.inbox.completeRouting.mockReturnValue(null);
		expect(() =>
			routeInboxDocument(p as never, { documentId: 'doc', destination: 'EXISTING', itemId: 'item' })
		).toThrow(InboxDocumentNotAvailableError);
		expect(p.inbox.releaseRouting).toHaveBeenCalledWith('doc', '2026-01-01T00:00:00.000Z');
		expect(p.attachmentStorage.remove).toHaveBeenCalledWith('cd/att');
	});
	it('prepares a new item inside the atomic routing operation', () => {
		const p = ports();
		routeInboxDocument(p as never, {
			documentId: 'doc',
			destination: 'GENERIC',
			newItemTitle: 'New item'
		});
		expect(p.inbox.completeRouting).toHaveBeenCalledWith(
			expect.objectContaining({
				destination: expect.objectContaining({
					kind: 'NEW',
					item: expect.objectContaining({ title: 'New item' })
				})
			})
		);
		expect(p.items.createItem).not.toHaveBeenCalled();
	});
	it('rejects changed pending bytes before creating an attachment', () => {
		const p = ports();
		p.storage.readBytes.mockReturnValue(new Uint8Array([1, 2, 3]));
		expect(() =>
			routeInboxDocument(p as never, { documentId: 'doc', destination: 'EXISTING', itemId: 'item' })
		).toThrow('INTEGRITY');
		expect(p.inbox.completeRouting).not.toHaveBeenCalled();
		expect(p.inbox.releaseRouting).toHaveBeenCalledWith('doc', '2026-01-01T00:00:00.000Z');
	});
	it('does not send an Inbox file above the configured AI byte limit', async () => {
		const p = ports();
		p.inbox.getById.mockReturnValue({
			id: 'doc',
			storageKey: 'ab/doc',
			filename: 'a.pdf',
			mimeType: 'application/pdf',
			sha256: PDF_SHA256,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			suggestion: null,
			status: 'PENDING',
			byteSize: 6
		});
		const provider = { providerId: 'test', modelId: 'test', route: vi.fn() };
		await expect(
			analyzeInboxDocument({ ...p, provider } as never, {
				documentId: 'doc',
				timeoutMs: 1,
				maxOutputTokens: 1,
				maxDocumentBytes: 4,
				dailyLimit: 3
			})
		).rejects.toThrow('TOO_LARGE');
		expect(provider.route).not.toHaveBeenCalled();
	});
	it('does not call the provider after AI consent is disabled', async () => {
		const p = ports();
		p.settings.get.mockReturnValue(null);
		const provider = { providerId: 'test', modelId: 'test', route: vi.fn() };
		await expect(
			analyzeInboxDocument({ ...p, provider } as never, {
				documentId: 'doc',
				timeoutMs: 1,
				maxOutputTokens: 1,
				maxDocumentBytes: 10,
				dailyLimit: 3
			})
		).rejects.toThrow('AI_DISABLED');
		expect(provider.route).not.toHaveBeenCalled();
		expect(p.runs.claimRun).not.toHaveBeenCalled();
	});
	it('does not send changed pending bytes to the provider and records the failed attempt', async () => {
		const p = ports();
		p.inbox.getById.mockReturnValue({
			id: 'doc',
			storageKey: 'ab/doc',
			filename: 'a.pdf',
			mimeType: 'application/pdf',
			sha256: PDF_SHA256,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			suggestion: null,
			status: 'PENDING',
			byteSize: PDF.byteLength
		});
		p.storage.readBytes.mockReturnValue(new Uint8Array([1, 2, 3]));
		const provider = { providerId: 'test', modelId: 'test', route: vi.fn() };
		await expect(
			analyzeInboxDocument({ ...p, provider } as never, {
				documentId: 'doc',
				timeoutMs: 1,
				maxOutputTokens: 1,
				maxDocumentBytes: 10,
				dailyLimit: 3
			})
		).rejects.toThrow('INTEGRITY');
		expect(provider.route).not.toHaveBeenCalled();
		expect(p.runs.markFailed).toHaveBeenCalledWith('att');
	});
	it('keeps Playbook metadata local and retains only a known suggestion', async () => {
		const p = ports();
		p.inbox.getById.mockReturnValue({
			id: 'doc',
			storageKey: 'ab/doc',
			filename: 'a.pdf',
			mimeType: 'application/pdf',
			sha256: PDF_SHA256,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			suggestion: null,
			status: 'PENDING',
			byteSize: PDF.byteLength
		});
		p.playbooks.list.mockReturnValue([{ id: 'leasing', name: 'Leasing', labelI18n: {} }]);
		const provider = {
			providerId: 'test',
			modelId: 'test',
			route: vi.fn(async () => ({
				documentKind: 'contract',
				playbookMatchingHints: ['Leasing'],
				itemMatchingHints: []
			}))
		};
		await analyzeInboxDocument({ ...p, provider } as never, {
			documentId: 'doc',
			timeoutMs: 1,
			maxOutputTokens: 1,
			maxDocumentBytes: 10,
			dailyLimit: 3
		});
		expect(provider.route).toHaveBeenCalledWith(
			expect.not.objectContaining({ playbooks: expect.anything() })
		);
		expect(p.inbox.updateSuggestion).toHaveBeenCalledWith(
			'doc',
			expect.objectContaining({ suggestedPlaybookId: 'leasing' }),
			expect.any(String)
		);
		expect(p.runs.markSucceeded).toHaveBeenCalledWith('att');
	});
});
