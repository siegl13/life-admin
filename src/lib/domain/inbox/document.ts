import type { AttachmentMimeType } from '../attachment/attachment';

export interface DocumentRouteSuggestion {
	documentKind: string | null;
	suggestedPlaybookId: string | null;
	suggestedItemIds: readonly string[];
	itemMatchingHints: readonly string[];
}

export interface InboxDocument {
	id: string;
	storageKey: string;
	filename: string;
	mimeType: AttachmentMimeType;
	byteSize: number;
	sha256: string;
	suggestion: DocumentRouteSuggestion | null;
	status: 'PENDING' | 'ROUTING';
	createdAt: string;
	updatedAt: string;
}

/**
 * Suggestions are persisted in SQLite and therefore must be treated as
 * hostile again when read after a restore or a manual database change.
 */
export function parseDocumentRouteSuggestion(value: unknown): DocumentRouteSuggestion | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (
		keys.length !== 4 ||
		!keys.every((key) =>
			['documentKind', 'suggestedPlaybookId', 'suggestedItemIds', 'itemMatchingHints'].includes(key)
		)
	)
		return null;
	const documentKind = record.documentKind;
	const suggestedPlaybookId = record.suggestedPlaybookId;
	const suggestedItemIds = record.suggestedItemIds;
	const itemMatchingHints = record.itemMatchingHints;
	if (
		(documentKind !== null && (typeof documentKind !== 'string' || documentKind.length > 80)) ||
		(suggestedPlaybookId !== null &&
			(typeof suggestedPlaybookId !== 'string' || suggestedPlaybookId.length > 128)) ||
		!Array.isArray(suggestedItemIds) ||
		!Array.isArray(itemMatchingHints) ||
		suggestedItemIds.length > 5 ||
		itemMatchingHints.length > 5 ||
		!suggestedItemIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 64) ||
		!itemMatchingHints.every(
			(hint) => typeof hint === 'string' && hint.length > 0 && hint.length <= 80
		)
	)
		return null;
	const itemIds = suggestedItemIds as string[];
	const hints = itemMatchingHints as string[];
	return {
		documentKind: documentKind as string | null,
		suggestedPlaybookId: suggestedPlaybookId as string | null,
		suggestedItemIds: itemIds,
		itemMatchingHints: hints
	};
}
