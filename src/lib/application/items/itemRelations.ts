import type { Clock, ItemRelationRepositoryPort, RelationCandidate, RelatedItem } from '../ports';

const ITEM_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_QUERY_CODE_POINTS = 120;

export class InvalidItemRelationError extends Error {
	constructor(
		public readonly reason:
			'MALFORMED_ID' | 'MISSING_ITEM' | 'SELF_LINK' | 'DUPLICATE' | 'NOT_LINKED' | 'ARCHIVED_ITEM'
	) {
		super(reason);
		this.name = 'InvalidItemRelationError';
	}
}

function assertIds(itemId: string, relatedItemId: string): void {
	if (!ITEM_ID_PATTERN.test(itemId) || !ITEM_ID_PATTERN.test(relatedItemId)) {
		throw new InvalidItemRelationError('MALFORMED_ID');
	}
	if (itemId === relatedItemId) throw new InvalidItemRelationError('SELF_LINK');
}

export function linkItems(
	ports: { relations: ItemRelationRepositoryPort; clock: Clock },
	input: { itemId: string; relatedItemId: string }
): void {
	assertIds(input.itemId, input.relatedItemId);
	const result = ports.relations.link(input.itemId, input.relatedItemId, ports.clock.nowIso());
	if (result === 'MISSING_ITEM') throw new InvalidItemRelationError('MISSING_ITEM');
	if (result === 'ARCHIVED_ITEM') throw new InvalidItemRelationError('ARCHIVED_ITEM');
	if (result === 'DUPLICATE') throw new InvalidItemRelationError('DUPLICATE');
}

export function unlinkItems(
	ports: { relations: ItemRelationRepositoryPort },
	input: { itemId: string; relatedItemId: string }
): void {
	assertIds(input.itemId, input.relatedItemId);
	const result = ports.relations.unlink(input.itemId, input.relatedItemId);
	if (result === 'MISSING_ITEM') throw new InvalidItemRelationError('MISSING_ITEM');
	if (result === 'ARCHIVED_ITEM') throw new InvalidItemRelationError('ARCHIVED_ITEM');
	if (result === 'NOT_LINKED') throw new InvalidItemRelationError('NOT_LINKED');
}

export function listRelatedItems(
	ports: { relations: ItemRelationRepositoryPort },
	itemId: string
): RelatedItem[] {
	return ports.relations.listRelated(itemId);
}

export function normalizeCandidateQuery(rawQuery: string): string {
	return Array.from(rawQuery.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase())
		.slice(0, MAX_QUERY_CODE_POINTS)
		.join('');
}

export function searchRelationCandidates(
	ports: { relations: ItemRelationRepositoryPort },
	itemId: string,
	rawQuery: string
): { query: string; candidates: RelationCandidate[] } {
	const query = normalizeCandidateQuery(rawQuery);
	return {
		query,
		candidates: ports.relations.listCandidates(itemId, query, query ? 20 : 5)
	};
}
