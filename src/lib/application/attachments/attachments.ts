import {
	detectAttachmentMimeType,
	MAX_ATTACHMENTS_PER_ITEM,
	MAX_ATTACHMENT_BYTES,
	normalizeAttachmentDisplayName,
	sanitizeFilename,
	type Attachment
} from '$lib/domain/attachment/attachment';
import type {
	AttachmentRepositoryPort,
	AttachmentStoragePort,
	Clock,
	CycleRepositoryPort,
	IdGeneratorPort,
	ItemRepositoryPort
} from '../ports';
type Ports = {
	items: ItemRepositoryPort;
	cycles: CycleRepositoryPort;
	attachments: AttachmentRepositoryPort;
	storage: AttachmentStoragePort;
	ids: IdGeneratorPort;
	clock: Clock;
};
export class AttachmentRejectedError extends Error {}
export class AttachmentRenameRejectedError extends Error {}
export function addAttachment(
	p: Ports,
	input: { itemId: string; filename: string; bytes: Uint8Array }
): Attachment {
	if (!p.items.getItemById(input.itemId)) throw new AttachmentRejectedError('ITEM_NOT_FOUND');
	if (!input.bytes.byteLength) throw new AttachmentRejectedError('EMPTY');
	if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentRejectedError('TOO_LARGE');
	if (p.attachments.countByItem(input.itemId) >= MAX_ATTACHMENTS_PER_ITEM)
		throw new AttachmentRejectedError('LIMIT');
	const mimeType = detectAttachmentMimeType(input.bytes.subarray(0, 16));
	if (!mimeType) throw new AttachmentRejectedError('TYPE');
	const id = p.ids.newId(),
		storageKey = p.storage.store(id, input.bytes);
	try {
		return p.attachments.insert({
			id,
			itemId: input.itemId,
			cycleId: p.cycles.getActiveCycle(input.itemId)?.id ?? null,
			filename: sanitizeFilename(input.filename),
			displayName: null,
			storageKey,
			mimeType,
			byteSize: input.bytes.byteLength,
			sha256: p.storage.sha256(input.bytes),
			uploadedAt: p.clock.nowIso()
		});
	} catch (error) {
		p.storage.remove(storageKey);
		throw error;
	}
}
export function getAttachmentForDownload(
	p: {
		items: ItemRepositoryPort;
		attachments: AttachmentRepositoryPort;
		storage: AttachmentStoragePort;
	},
	itemId: string,
	id: string
) {
	if (!p.items.getItemById(itemId)) return null;
	const attachment = p.attachments.getById(id);
	return !attachment || attachment.itemId !== itemId
		? null
		: { attachment, stream: p.storage.openReadStream(attachment.storageKey) };
}

export function getAttachmentForItem(
	p: { items: ItemRepositoryPort; attachments: AttachmentRepositoryPort },
	itemId: string,
	id: string
): Attachment | null {
	if (!p.items.getItemById(itemId)) return null;
	const attachment = p.attachments.getById(id);
	return !attachment || attachment.itemId !== itemId ? null : attachment;
}

type RenamePorts = Pick<Ports, 'items' | 'attachments'>;

export function renameAttachment(
	p: RenamePorts,
	input: { itemId: string; attachmentId: string; displayName: string | null }
): Attachment {
	const item = p.items.getItemById(input.itemId);
	if (!item || item.status !== 'ACTIVE') {
		throw new AttachmentRenameRejectedError(item ? 'ITEM_NOT_WRITABLE' : 'ATTACHMENT_NOT_FOUND');
	}
	const attachment = p.attachments.getById(input.attachmentId);
	if (!attachment || attachment.itemId !== input.itemId) {
		throw new AttachmentRenameRejectedError('ATTACHMENT_NOT_FOUND');
	}
	const displayName = normalizeAttachmentDisplayName(input.displayName ?? '');
	const renamed = p.attachments.rename(input.itemId, input.attachmentId, displayName);
	if (!renamed) throw new AttachmentRenameRejectedError('ATTACHMENT_NOT_FOUND');
	return renamed;
}
/**
 * Removes an attachment's metadata row and its on-disk bytes. The actual
 * ACTIVE-item guard lives in `attachments.deleteById` itself (it throws
 * `ItemNotWritableError` and deletes nothing if the item is archived by
 * the time this reaches the database) — this function only decides
 * whether the attachment is a plausible target at all, it is not the
 * authority on whether the delete may proceed (Slice 8 review, finding 2).
 */
export function removeAttachment(
	p: { attachments: AttachmentRepositoryPort; storage: AttachmentStoragePort },
	itemId: string,
	id: string
): void {
	const attachment = p.attachments.getById(id);
	if (!attachment || attachment.itemId !== itemId) return;
	const deleted = p.attachments.deleteById(id);
	if (deleted) p.storage.remove(deleted.storageKey);
}
