import type { AttachmentMimeType } from '$lib/domain/attachment/attachment';
import type { DocumentRouteSuggestion } from '$lib/domain/inbox/document';

export interface RoutingDocument {
	mimeType: AttachmentMimeType;
	bytes: Uint8Array;
}
export interface RoutingRequest {
	document: RoutingDocument;
	timeoutMs: number;
	maxOutputTokens: number;
}
export interface RoutingResult {
	documentKind: string | null;
	playbookMatchingHints: readonly string[];
	itemMatchingHints: readonly string[];
	providerId: string;
	modelId: string;
}
export interface DocumentRoutingProviderPort {
	readonly providerId: string;
	readonly modelId: string;
	route(request: RoutingRequest): Promise<RoutingResult>;
}

interface RoutingPlaybookCandidate {
	id: string;
	name: string;
	labelI18n: Record<string, string>;
}

function normalizedWords(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

function matchesPlaybookHint(playbook: RoutingPlaybookCandidate, hint: string): boolean {
	const normalizedHint = normalizedWords(hint);
	if (!normalizedHint) return false;
	return [playbook.name, ...Object.values(playbook.labelI18n)].some((label) => {
		const normalizedLabel = normalizedWords(label);
		if (normalizedLabel === normalizedHint) return true;
		const labelContainsHint = ` ${normalizedLabel} `.includes(` ${normalizedHint} `);
		const hintContainsLabel = ` ${normalizedHint} `.includes(` ${normalizedLabel} `);
		return (
			normalizedHint.split(' ').length >= 2 &&
			normalizedLabel.split(' ').length >= 2 &&
			(labelContainsHint || hintContainsLabel)
		);
	});
}

/** Model text is never retained. Only a bounded, locally-authorized projection
 * is returned to the caller. */
export function normalizeRoutingSuggestion(
	result: Pick<RoutingResult, 'documentKind' | 'playbookMatchingHints' | 'itemMatchingHints'>,
	knownPlaybooks: readonly RoutingPlaybookCandidate[],
	knownItems: readonly { id: string; title: string }[] = []
): DocumentRouteSuggestion {
	const playbookHints = [
		...new Set(result.playbookMatchingHints.filter((hint) => hint.length > 0 && hint.length <= 80))
	].slice(0, 5);
	const hints = [
		...new Set(result.itemMatchingHints.filter((hint) => hint.length > 0 && hint.length <= 80))
	].slice(0, 5);
	const matchingPlaybookIds = [
		...new Set(
			knownPlaybooks
				.filter((playbook) => playbookHints.some((hint) => matchesPlaybookHint(playbook, hint)))
				.map((playbook) => playbook.id)
		)
	];
	return {
		documentKind:
			result.documentKind && result.documentKind.length <= 80 ? result.documentKind : null,
		suggestedPlaybookId: matchingPlaybookIds.length === 1 ? matchingPlaybookIds[0] : null,
		suggestedItemIds: knownItems
			.filter((item) =>
				hints.some((hint) => item.title.toLocaleLowerCase().includes(hint.toLocaleLowerCase()))
			)
			.map((item) => item.id)
			.slice(0, 5),
		itemMatchingHints: hints
	};
}

export function restrictRoutingSuggestion(
	suggestion: DocumentRouteSuggestion,
	knownPlaybookIds: readonly string[],
	knownItemIds: readonly string[]
): DocumentRouteSuggestion {
	return {
		...suggestion,
		suggestedPlaybookId:
			suggestion.suggestedPlaybookId && knownPlaybookIds.includes(suggestion.suggestedPlaybookId)
				? suggestion.suggestedPlaybookId
				: null,
		suggestedItemIds: suggestion.suggestedItemIds
			.filter((id) => knownItemIds.includes(id))
			.slice(0, 5)
	};
}
