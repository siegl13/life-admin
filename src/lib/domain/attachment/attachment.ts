export type AttachmentMimeType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_ITEM = 50;

/** A caller-provided read limit was exceeded before file bytes were loaded. */
export class AttachmentReadLimitError extends Error {}

export interface Attachment {
	id: string;
	itemId: string;
	cycleId: string | null;
	filename: string;
	displayName: string | null;
	storageKey: string;
	mimeType: AttachmentMimeType;
	byteSize: number;
	sha256: string;
	uploadedAt: string;
}

export const MAX_ATTACHMENT_DISPLAY_NAME_CODE_POINTS = 120;
export class AttachmentDisplayNameTooLongError extends Error {}

export function normalizeAttachmentDisplayName(raw: string): string | null {
	const normalized = raw
		.replace(/[\p{Cc}\p{Cf}]/gu, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!normalized) return null;
	if (Array.from(normalized).length > MAX_ATTACHMENT_DISPLAY_NAME_CODE_POINTS) {
		throw new AttachmentDisplayNameTooLongError('ATTACHMENT_DISPLAY_NAME_TOO_LONG');
	}
	return normalized;
}

export function attachmentDisplayName(
	attachment: Pick<Attachment, 'displayName' | 'filename'>
): string {
	return attachment.displayName?.trim() || attachment.filename;
}
export function sanitizeFilename(raw: string): string {
	let value = raw
		.trim()
		.replace(/[\\/]/g, '_')
		.replaceAll('\0', '_')
		.replace(/[\p{Cc}]/gu, '_')
		.replace(/^\.+/, '')
		.replace(/\s+/g, ' ');
	if (!value || /^_+$/.test(value)) value = 'dokument';
	if (value.length <= 200) return value;
	const dot = value.lastIndexOf('.');
	const extension = dot > 0 && value.length - dot <= 20 ? value.slice(dot) : '';
	return value.slice(0, 200 - extension.length) + extension;
}
export function detectAttachmentMimeType(head: Uint8Array): AttachmentMimeType | null {
	const starts = (...bytes: number[]) => bytes.every((byte, index) => head[index] === byte);
	if (head.length >= 5 && starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
	if (head.length >= 3 && starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
	if (head.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
		return 'image/png';
	if (
		head.length >= 12 &&
		starts(0x52, 0x49, 0x46, 0x46) &&
		String.fromCharCode(...head.slice(8, 12)) === 'WEBP'
	)
		return 'image/webp';
	return null;
}
export function isValidStorageKey(key: string): boolean {
	return /^[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
		key
	);
}
export function formatByteSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
}
