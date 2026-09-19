import { describe, expect, it, vi } from 'vitest';
import { extractFromDocument, ExtractionNotAllowedError } from './extractFromDocument';
import { DailyExtractionLimitReachedError } from './ports';
import {
	ExtractionFailedError,
	ExtractionTimeoutError,
	type ExtractionRequest
} from './extraction';

const BOUNDS = {
	hasApiKey: true,
	maxDocumentBytes: 8 * 1024 * 1024,
	timeoutMs: 60_000,
	maxOutputTokens: 2000,
	dailyLimit: 20
};

function fakePorts(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		items: { getItemById: vi.fn(() => ({ id: 'item-1', status: 'ACTIVE' })) },
		cycles: { getActiveCycle: vi.fn(() => ({ id: 'cycle-1' })) },
		fields: {
			listFields: vi.fn(() => [
				{ fieldKey: 'contract_end', label: 'Contract end', type: 'date', value: null },
				{ fieldKey: 'note', label: 'Note', type: 'text', value: null }
			])
		},
		attachments: {
			getById: vi.fn(() => ({
				id: 'att-1',
				itemId: 'item-1',
				mimeType: 'application/pdf',
				byteSize: 1000,
				storageKey: 'ab/att-1'
			}))
		},
		attachmentBytes: { readBytes: vi.fn(() => new Uint8Array([1, 2, 3])) },
		settings: {
			get: vi.fn((key: string) => (key === 'ai.enabled' ? '1' : null)),
			set: vi.fn()
		},
		runs: {
			claimRun: vi.fn(),
			markSucceeded: vi.fn(),
			markFailed: vi.fn(),
			getById: vi.fn(),
			findNewestPendingRun: vi.fn(),
			listSuggestions: vi.fn(),
			applyRun: vi.fn(),
			dismissRun: vi.fn()
		},
		provider: {
			providerId: 'fake',
			modelId: 'fake-v1',
			extract: vi.fn(async (_request: ExtractionRequest) => ({
				providerId: 'fake',
				modelId: 'fake-v1',
				suggestions: [{ fieldKey: 'contract_end', value: '2031-03-15' }]
			}))
		},
		ids: { newId: vi.fn(() => 'run-1') },
		clock: {
			nowIso: vi.fn(() => '2026-01-01T00:00:00.000Z'),
			todayIso: vi.fn(() => '2026-01-01'),
			localHour: vi.fn(() => 12)
		},
		...overrides
	};
}

describe('extractFromDocument', () => {
	it('refuses when AI is disabled, before any provider call', async () => {
		const p = fakePorts({ settings: { get: vi.fn(() => null), set: vi.fn() } });
		await expect(
			extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS)
		).rejects.toThrow(ExtractionNotAllowedError);
		expect(p.provider.extract).not.toHaveBeenCalled();
		expect(p.runs.claimRun).not.toHaveBeenCalled();
	});

	it('refuses without a configured key, before any provider call', async () => {
		const p = fakePorts();
		await expect(
			extractFromDocument(
				p as never,
				{ itemId: 'item-1', attachmentId: 'att-1' },
				{ ...BOUNDS, hasApiKey: false }
			)
		).rejects.toThrow(ExtractionNotAllowedError);
		expect(p.provider.extract).not.toHaveBeenCalled();
	});

	it('refuses for an inactive (e.g. archived) Item, before any provider or repository claim call', async () => {
		const p = fakePorts({
			items: { getItemById: vi.fn(() => ({ id: 'item-1', status: 'ARCHIVED' })) }
		});
		await expect(
			extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS)
		).rejects.toThrow(ExtractionNotAllowedError);
		expect(p.provider.extract).not.toHaveBeenCalled();
		expect(p.runs.claimRun).not.toHaveBeenCalled();
	});

	it('refuses when the Item has no ACTIVE Cycle, before any provider or repository claim call', async () => {
		const p = fakePorts({ cycles: { getActiveCycle: vi.fn(() => null) } });
		await expect(
			extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS)
		).rejects.toThrow(ExtractionNotAllowedError);
		expect(p.provider.extract).not.toHaveBeenCalled();
		expect(p.runs.claimRun).not.toHaveBeenCalled();
	});

	it('refuses for an unsupported MIME type before any provider call', async () => {
		const p = fakePorts({
			attachments: {
				getById: vi.fn(() => ({
					id: 'att-1',
					itemId: 'item-1',
					mimeType: 'text/plain',
					byteSize: 10,
					storageKey: 'ab/att-1'
				}))
			}
		});
		await expect(
			extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS)
		).rejects.toThrow(ExtractionNotAllowedError);
		expect(p.provider.extract).not.toHaveBeenCalled();
	});

	it('refuses over the max document size before any provider call', async () => {
		const p = fakePorts({
			attachments: {
				getById: vi.fn(() => ({
					id: 'att-1',
					itemId: 'item-1',
					mimeType: 'application/pdf',
					byteSize: 9 * 1024 * 1024,
					storageKey: 'ab/att-1'
				}))
			}
		});
		await expect(
			extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS)
		).rejects.toThrow(ExtractionNotAllowedError);
		expect(p.provider.extract).not.toHaveBeenCalled();
	});

	it('refuses at the daily cap, mapped from the repository error, before any provider call', async () => {
		const p = fakePorts({
			runs: {
				claimRun: vi.fn(() => {
					throw new DailyExtractionLimitReachedError();
				}),
				markSucceeded: vi.fn(),
				markFailed: vi.fn(),
				getById: vi.fn(),
				findNewestPendingRun: vi.fn(),
				listSuggestions: vi.fn(),
				applyRun: vi.fn(),
				dismissRun: vi.fn()
			}
		});
		await expect(
			extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS)
		).rejects.toThrow(ExtractionNotAllowedError);
		expect(p.provider.extract).not.toHaveBeenCalled();
	});

	it('refuses for an attachment belonging to a different item', async () => {
		const p = fakePorts({
			attachments: {
				getById: vi.fn(() => ({
					id: 'att-1',
					itemId: 'other-item',
					mimeType: 'application/pdf',
					byteSize: 10,
					storageKey: 'ab/att-1'
				}))
			}
		});
		await expect(
			extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS)
		).rejects.toThrow(ExtractionNotAllowedError);
	});

	it('the request sent to the provider contains only this cycle’s field definitions', async () => {
		const p = fakePorts();
		await extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS);
		const request = p.provider.extract.mock.calls[0][0];
		expect(request.fields).toEqual([
			{ fieldKey: 'contract_end', label: 'Contract end', type: 'date' },
			{ fieldKey: 'note', label: 'Note', type: 'text' }
		]);
	});

	it('the request sent to the provider contains no field values', async () => {
		const p = fakePorts();
		await extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS);
		const request = p.provider.extract.mock.calls[0][0];
		expect(JSON.stringify(request.fields)).not.toContain('value');
	});

	it('marks the run FAILED and rethrows on a provider timeout, creating no suggestions', async () => {
		const p = fakePorts({
			provider: {
				providerId: 'fake',
				modelId: 'fake-v1',
				extract: vi.fn(async () => {
					throw new ExtractionTimeoutError('timed out');
				})
			}
		});
		await expect(
			extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS)
		).rejects.toThrow(ExtractionTimeoutError);
		expect(p.runs.markFailed).toHaveBeenCalledWith('run-1');
		expect(p.runs.markSucceeded).not.toHaveBeenCalled();
	});

	it('marks the run FAILED, not RUNNING, when reading the attachment bytes throws after the claim', async () => {
		const p = fakePorts({
			attachmentBytes: {
				readBytes: vi.fn(() => {
					throw new Error('ENOENT: /data/attachments/ab/att-1');
				})
			}
		});
		await expect(
			extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS)
		).rejects.toThrow(ExtractionFailedError);
		expect(p.runs.markFailed).toHaveBeenCalledWith('run-1');
		expect(p.runs.markSucceeded).not.toHaveBeenCalled();
		expect(p.provider.extract).not.toHaveBeenCalled();
		// The raw filesystem error (with its path) must never reach the
		// caller — only the safe, typed, mapped failure.
		try {
			await extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS);
		} catch (err) {
			expect(String((err as Error).message)).not.toContain('/data/attachments');
		}
	});

	it('rejects when the actual attachment bytes exceed the size bound even though the stored metadata reports a smaller size, before any provider call', async () => {
		const p = fakePorts({
			attachments: {
				getById: vi.fn(() => ({
					id: 'att-1',
					itemId: 'item-1',
					mimeType: 'application/pdf',
					byteSize: 10, // stale/wrong metadata: well under the bound
					storageKey: 'ab/att-1'
				}))
			},
			attachmentBytes: {
				// The real bytes on disk disagree with the metadata above.
				readBytes: vi.fn(() => new Uint8Array(BOUNDS.maxDocumentBytes + 1))
			}
		});
		await expect(
			extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS)
		).rejects.toThrow(ExtractionNotAllowedError);
		expect(p.attachmentBytes.readBytes).toHaveBeenCalledWith('ab/att-1', BOUNDS.maxDocumentBytes);
		expect(p.provider.extract).not.toHaveBeenCalled();
		expect(p.runs.markFailed).toHaveBeenCalledWith('run-1');
	});

	it('claims the RUNNING row before ever calling the provider', async () => {
		const order: string[] = [];
		const p = fakePorts();
		p.runs.claimRun.mockImplementation(() => order.push('claim'));
		p.provider.extract.mockImplementation(async () => {
			order.push('extract');
			return { providerId: 'fake', modelId: 'fake-v1', suggestions: [] };
		});
		await extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS);
		expect(order).toEqual(['claim', 'extract']);
	});

	it('unknown/invalid suggestions are counted as discarded and not persisted', async () => {
		const p = fakePorts({
			provider: {
				providerId: 'fake',
				modelId: 'fake-v1',
				extract: vi.fn(async () => ({
					providerId: 'fake',
					modelId: 'fake-v1',
					suggestions: [
						{ fieldKey: 'contract_end', value: '2031-03-15' },
						{ fieldKey: 'unknown_field_from_model', value: 'x' }
					]
				}))
			}
		});
		await extractFromDocument(p as never, { itemId: 'item-1', attachmentId: 'att-1' }, BOUNDS);
		expect(p.runs.markSucceeded).toHaveBeenCalledWith(
			'run-1',
			expect.objectContaining({
				suggestions: [{ fieldKey: 'contract_end', value: '2031-03-15', position: 0 }],
				discardedCount: 1
			})
		);
	});
});
