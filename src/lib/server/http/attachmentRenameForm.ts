import { normalizeAttachmentDisplayName, type Attachment } from '$lib/domain/attachment/attachment';

export class AttachmentRenameFormError extends Error {}

/** Parses the complete aggregate form so malformed fields cannot be ignored. */
export function parseAttachmentRenameForm(
	data: FormData
): { attachmentId: string; displayName: string }[] {
	const attachmentIds = new Set<string>();
	const displayNames = new Map<string, string>();

	for (const [key, value] of data.entries()) {
		if (typeof value !== 'string') throw new AttachmentRenameFormError('ATTACHMENT_NOT_FOUND');
		if (key === 'attachmentId') {
			if (attachmentIds.has(value)) throw new AttachmentRenameFormError('ATTACHMENT_NOT_FOUND');
			attachmentIds.add(value);
			continue;
		}
		if (!key.startsWith('displayName:')) continue;
		const attachmentId = key.slice('displayName:'.length);
		if (!attachmentId || displayNames.has(attachmentId)) {
			throw new AttachmentRenameFormError('ATTACHMENT_NOT_FOUND');
		}
		displayNames.set(attachmentId, value);
	}

	if (
		attachmentIds.size !== displayNames.size ||
		[...attachmentIds].some((attachmentId) => !displayNames.has(attachmentId))
	) {
		throw new AttachmentRenameFormError('ATTACHMENT_NOT_FOUND');
	}

	return [...attachmentIds].map((attachmentId) => ({
		attachmentId,
		displayName: displayNames.get(attachmentId)!
	}));
}

/** Validates the complete HTML form before invoking the singular rename operation. */
export function submitAttachmentRenameForm(
	attachments: readonly Attachment[],
	entries: readonly { attachmentId: string; displayName: string }[],
	rename: (entry: { attachmentId: string; displayName: string | null }) => void
): void {
	const currentById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
	const submittedIds = new Set<string>();
	const normalized = entries.map((entry) => {
		if (submittedIds.has(entry.attachmentId) || !currentById.has(entry.attachmentId)) {
			throw new AttachmentRenameFormError('ATTACHMENT_NOT_FOUND');
		}
		submittedIds.add(entry.attachmentId);
		return {
			attachmentId: entry.attachmentId,
			displayName: normalizeAttachmentDisplayName(entry.displayName)
		};
	});
	if (submittedIds.size !== currentById.size) {
		throw new AttachmentRenameFormError('ATTACHMENT_NOT_FOUND');
	}

	for (const entry of normalized) {
		if (currentById.get(entry.attachmentId)!.displayName !== entry.displayName) rename(entry);
	}
}
