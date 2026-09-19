import { describe, expect, it, vi } from 'vitest';
import {
	addAttachment,
	AttachmentRejectedError,
	getAttachmentForDownload,
	renameAttachment,
	removeAttachment
} from './attachments';
import type { Attachment } from '$lib/domain/attachment/attachment';

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...new Array(20).fill(0)]);

function fakePorts(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		items: { getItemById: vi.fn(() => ({ id: 'item-1' })) },
		cycles: { getActiveCycle: vi.fn(() => null) },
		attachments: {
			listByItem: vi.fn(() => []),
			countByItem: vi.fn(() => 0),
			insert: vi.fn((row: unknown) => row as Attachment),
			getById: vi.fn(),
			rename: vi.fn(),
			deleteById: vi.fn()
		},
		storage: {
			store: vi.fn(() => 'ab/some-id'),
			remove: vi.fn(),
			sha256: vi.fn(() => 'a'.repeat(64)),
			readBytes: vi.fn(),
			openReadStream: vi.fn(() => 'stream')
		},
		ids: { newId: vi.fn(() => 'some-id') },
		clock: {
			nowIso: vi.fn(() => '2026-01-01T00:00:00.000Z'),
			todayIso: vi.fn(() => '2026-01-01'),
			localHour: vi.fn(() => 12)
		},
		...overrides
	};
}

describe('addAttachment', () => {
	it('rejects when the item does not exist, before touching storage', () => {
		const p = fakePorts({ items: { getItemById: vi.fn(() => null) } });
		expect(() =>
			addAttachment(p as never, { itemId: 'missing', filename: 'a.pdf', bytes: PDF_BYTES })
		).toThrow(AttachmentRejectedError);
		expect(p.storage.store).not.toHaveBeenCalled();
	});

	it('rejects empty input before touching storage', () => {
		const p = fakePorts();
		expect(() =>
			addAttachment(p as never, { itemId: 'item-1', filename: 'a.pdf', bytes: new Uint8Array() })
		).toThrow(AttachmentRejectedError);
		expect(p.storage.store).not.toHaveBeenCalled();
	});

	it('rejects a file over the byte cap before touching storage', () => {
		const p = fakePorts();
		const big = new Uint8Array(11 * 1024 * 1024);
		big.set(PDF_BYTES);
		expect(() =>
			addAttachment(p as never, { itemId: 'item-1', filename: 'a.pdf', bytes: big })
		).toThrow(AttachmentRejectedError);
		expect(p.storage.store).not.toHaveBeenCalled();
	});

	it('rejects once the per-item limit is reached, before touching storage', () => {
		const p = fakePorts({
			attachments: {
				countByItem: vi.fn(() => 50),
				insert: vi.fn(),
				getById: vi.fn(),
				deleteById: vi.fn()
			}
		});
		expect(() =>
			addAttachment(p as never, { itemId: 'item-1', filename: 'a.pdf', bytes: PDF_BYTES })
		).toThrow(AttachmentRejectedError);
		expect(p.storage.store).not.toHaveBeenCalled();
	});

	it('rejects a disallowed type based on sniffed bytes, regardless of filename', () => {
		const p = fakePorts();
		const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
		expect(() =>
			addAttachment(p as never, { itemId: 'item-1', filename: 'looks-like.pdf', bytes: svg })
		).toThrow(AttachmentRejectedError);
		expect(p.storage.store).not.toHaveBeenCalled();
	});

	it('calls storage.store before attachments.insert', () => {
		const p = fakePorts();
		const order: string[] = [];
		p.storage.store.mockImplementation(() => {
			order.push('store');
			return 'ab/some-id';
		});
		p.attachments.insert.mockImplementation((row: unknown) => {
			order.push('insert');
			return row as Attachment;
		});
		addAttachment(p as never, { itemId: 'item-1', filename: 'a.pdf', bytes: PDF_BYTES });
		expect(order).toEqual(['store', 'insert']);
	});

	it('removes the stored file when the repository insert throws, then rethrows', () => {
		const p = fakePorts();
		const insertError = new Error('unique constraint');
		p.attachments.insert.mockImplementation(() => {
			throw insertError;
		});
		expect(() =>
			addAttachment(p as never, { itemId: 'item-1', filename: 'a.pdf', bytes: PDF_BYTES })
		).toThrow(insertError);
		expect(p.storage.remove).toHaveBeenCalledWith('ab/some-id');
	});
});

describe('attachment display-name management', () => {
	it('singular rename repeats active-item and item/attachment pairing checks', () => {
		const archived = fakePorts({
			items: { getItemById: vi.fn(() => ({ id: 'item-1', status: 'ARCHIVED' })) }
		});
		expect(() =>
			renameAttachment(archived as never, {
				itemId: 'item-1',
				attachmentId: 'att-1',
				displayName: 'Name'
			})
		).toThrow('ITEM_NOT_WRITABLE');
		expect(archived.attachments.rename).not.toHaveBeenCalled();

		const mismatched = fakePorts({
			items: { getItemById: vi.fn(() => ({ id: 'item-1', status: 'ACTIVE' })) },
			attachments: {
				listByItem: vi.fn(),
				countByItem: vi.fn(),
				insert: vi.fn(),
				getById: vi.fn(() => ({ id: 'att-1', itemId: 'other' })),
				rename: vi.fn(),
				deleteById: vi.fn()
			}
		});
		expect(() =>
			renameAttachment(mismatched as never, {
				itemId: 'item-1',
				attachmentId: 'att-1',
				displayName: 'Name'
			})
		).toThrow('ATTACHMENT_NOT_FOUND');
		expect(mismatched.attachments.rename).not.toHaveBeenCalled();
	});
});

describe('getAttachmentForDownload', () => {
	it('returns null when the item does not exist', () => {
		const p = fakePorts({ items: { getItemById: vi.fn(() => null) } });
		expect(getAttachmentForDownload(p as never, 'item-1', 'att-1')).toBeNull();
	});

	it('returns null when the attachment belongs to a different item', () => {
		const p = fakePorts({
			attachments: {
				getById: vi.fn(() => ({ id: 'att-1', itemId: 'other-item' })),
				countByItem: vi.fn(),
				insert: vi.fn(),
				deleteById: vi.fn()
			}
		});
		expect(getAttachmentForDownload(p as never, 'item-1', 'att-1')).toBeNull();
	});

	it('returns the attachment and a stream when it belongs to the requested item', () => {
		const p = fakePorts({
			attachments: {
				getById: vi.fn(() => ({ id: 'att-1', itemId: 'item-1', storageKey: 'ab/att-1' })),
				countByItem: vi.fn(),
				insert: vi.fn(),
				deleteById: vi.fn()
			}
		});
		const result = getAttachmentForDownload(p as never, 'item-1', 'att-1');
		expect(result?.attachment.id).toBe('att-1');
		expect(p.storage.openReadStream).toHaveBeenCalledWith('ab/att-1');
	});
});

describe('removeAttachment', () => {
	it('does nothing when the attachment belongs to a different item', () => {
		const p = fakePorts({
			attachments: {
				getById: vi.fn(() => ({ id: 'att-1', itemId: 'other-item', storageKey: 'ab/att-1' })),
				countByItem: vi.fn(),
				insert: vi.fn(),
				deleteById: vi.fn()
			}
		});
		removeAttachment(p as never, 'item-1', 'att-1');
		expect(p.attachments.deleteById).not.toHaveBeenCalled();
		expect(p.storage.remove).not.toHaveBeenCalled();
	});

	it('deletes the row before unlinking the file', () => {
		const order: string[] = [];
		const p = fakePorts({
			attachments: {
				getById: vi.fn(() => ({ id: 'att-1', itemId: 'item-1', storageKey: 'ab/att-1' })),
				countByItem: vi.fn(),
				insert: vi.fn(),
				deleteById: vi.fn(() => {
					order.push('delete');
					return { id: 'att-1', itemId: 'item-1', storageKey: 'ab/att-1' };
				})
			}
		});
		p.storage.remove.mockImplementation(() => order.push('remove'));
		removeAttachment(p as never, 'item-1', 'att-1');
		expect(order).toEqual(['delete', 'remove']);
	});

	it('never unlinks the file when the repository refuses the delete (e.g. archived in the meantime), and lets the error propagate (Slice 8 review, finding 2)', () => {
		const notWritable = new Error('item not writable');
		const p = fakePorts({
			attachments: {
				getById: vi.fn(() => ({ id: 'att-1', itemId: 'item-1', storageKey: 'ab/att-1' })),
				countByItem: vi.fn(),
				insert: vi.fn(),
				deleteById: vi.fn(() => {
					throw notWritable;
				})
			}
		});
		expect(() => removeAttachment(p as never, 'item-1', 'att-1')).toThrow(notWritable);
		expect(p.storage.remove).not.toHaveBeenCalled();
	});
});
