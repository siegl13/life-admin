import type { AttachmentMimeType } from '$lib/domain/attachment/attachment';

const INLINE_MIME_TYPES = new Set<string>([
	'application/pdf',
	'image/jpeg',
	'image/png',
	'image/webp'
]);

function encodedFilename(name: string): string {
	return encodeURIComponent(name).replace(
		/['()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

export function attachmentDisposition(name: string, inline: boolean): string {
	const bounded = Array.from(name.toWellFormed()).slice(0, 200).join('');
	const ascii = bounded.replace(/[^\x20-\x7e]|["\\\r\n]/g, '_') || 'dokument';
	return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodedFilename(bounded)}`;
}

export function attachmentContentHeaders(
	attachment: { filename: string; mimeType: AttachmentMimeType | string; byteSize: number },
	download: boolean
): Record<string, string> {
	const inline = !download && INLINE_MIME_TYPES.has(attachment.mimeType);
	return {
		'content-type': attachment.mimeType,
		'content-length': String(attachment.byteSize),
		'content-disposition': attachmentDisposition(attachment.filename, inline),
		'x-content-type-options': 'nosniff',
		'x-frame-options': inline && attachment.mimeType === 'application/pdf' ? 'SAMEORIGIN' : 'DENY',
		'content-security-policy': "default-src 'none'; sandbox",
		'cache-control': 'private, no-store'
	};
}
