import type Database from 'better-sqlite3';
import type {
	ItemRelationRepositoryPort,
	LinkItemsResult,
	RelationCandidate,
	RelatedItem,
	UnlinkItemsResult
} from '$lib/application/ports';
import type { ItemRelation } from '$lib/domain/item/relation';
import { canonicalItemPair } from '$lib/domain/item/relation';

interface RelationRow {
	item_a_id: string;
	item_b_id: string;
	created_at: string;
}

function statuses(
	db: Database.Database,
	itemAId: string,
	itemBId: string
): { id: string; status: string }[] {
	return db.prepare('SELECT id, status FROM items WHERE id IN (?, ?)').all(itemAId, itemBId) as {
		id: string;
		status: string;
	}[];
}

export function link(
	db: Database.Database,
	itemAId: string,
	itemBId: string,
	createdAt: string
): LinkItemsResult {
	return db.transaction((): LinkItemsResult => {
		const found = statuses(db, itemAId, itemBId);
		const source = found.find((item) => item.id === itemAId);
		if (!source) return 'MISSING_ITEM';
		if (source.status !== 'ACTIVE') return 'ARCHIVED_ITEM';
		const target = found.find((item) => item.id === itemBId);
		if (!target || target.status !== 'ACTIVE') return 'MISSING_ITEM';
		const [itemA, itemB] = canonicalItemPair(itemAId, itemBId);
		const result = db
			.prepare(
				'INSERT INTO item_relations (item_a_id, item_b_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
			)
			.run(itemA, itemB, createdAt);
		return result.changes === 1 ? 'LINKED' : 'DUPLICATE';
	})();
}

export function unlink(db: Database.Database, itemAId: string, itemBId: string): UnlinkItemsResult {
	return db.transaction((): UnlinkItemsResult => {
		const found = statuses(db, itemAId, itemBId);
		const source = found.find((item) => item.id === itemAId);
		if (!source) return 'MISSING_ITEM';
		if (source.status !== 'ACTIVE') return 'ARCHIVED_ITEM';
		if (!found.some((item) => item.id === itemBId)) return 'MISSING_ITEM';
		const [itemA, itemB] = canonicalItemPair(itemAId, itemBId);
		const result = db
			.prepare('DELETE FROM item_relations WHERE item_a_id = ? AND item_b_id = ?')
			.run(itemA, itemB);
		return result.changes === 1 ? 'UNLINKED' : 'NOT_LINKED';
	})();
}

export function listRelated(db: Database.Database, itemId: string): RelatedItem[] {
	const related = db
		.prepare(
			`SELECT i.id, i.title, i.playbook_name AS playbookName, i.status
			 FROM item_relations r
			 JOIN items i ON i.id = CASE WHEN r.item_a_id = ? THEN r.item_b_id ELSE r.item_a_id END
			 WHERE r.item_a_id = ? OR r.item_b_id = ?
			 ORDER BY i.title COLLATE NOCASE, i.id`
		)
		.all(itemId, itemId, itemId) as RelatedItem[];
	const collator = new Intl.Collator('de', { sensitivity: 'base' });
	return related.sort(
		(left, right) => collator.compare(left.title, right.title) || left.id.localeCompare(right.id)
	);
}

export function listCandidates(
	db: Database.Database,
	itemId: string,
	query: string,
	limit: number
): RelationCandidate[] {
	const boundedLimit = Math.max(0, Math.min(20, limit));
	const normalized = query.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
	db.function('relation_normalize', (value: string | null) =>
		value === null ? '' : value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
	);
	return db
		.prepare(
			`SELECT i.id, i.title, i.playbook_name AS playbookName, i.status, i.updated_at AS updatedAt,
			        EXISTS (
			          SELECT 1 FROM item_relations r
			          WHERE (r.item_a_id = ? AND r.item_b_id = i.id)
			             OR (r.item_b_id = ? AND r.item_a_id = i.id)
			        ) AS alreadyLinked
			 FROM items i
			 WHERE i.status = 'ACTIVE' AND i.id <> ?
			   AND (? = '' OR instr(relation_normalize(i.title), ?) > 0)
			 ORDER BY CASE WHEN ? = '' THEN i.updated_at END DESC,
			          CASE WHEN ? = '' THEN i.rowid END DESC,
			          i.title COLLATE NOCASE, i.id
			 LIMIT ?`
		)
		.all(itemId, itemId, itemId, normalized, normalized, normalized, normalized, boundedLimit)
		.map((row) => {
			const candidate = row as Omit<RelationCandidate, 'alreadyLinked'> & {
				alreadyLinked: number;
			};
			return { ...candidate, alreadyLinked: candidate.alreadyLinked === 1 };
		});
}

export function countRelated(db: Database.Database, itemId: string): number {
	return (
		db
			.prepare('SELECT count(*) AS count FROM item_relations WHERE item_a_id = ? OR item_b_id = ?')
			.get(itemId, itemId) as { count: number }
	).count;
}

export function deleteForItem(db: Database.Database, itemId: string): number {
	return db
		.prepare('DELETE FROM item_relations WHERE item_a_id = ? OR item_b_id = ?')
		.run(itemId, itemId).changes;
}

export function get(db: Database.Database, itemAId: string, itemBId: string): ItemRelation | null {
	const [itemA, itemB] = canonicalItemPair(itemAId, itemBId);
	const row = db
		.prepare('SELECT * FROM item_relations WHERE item_a_id = ? AND item_b_id = ?')
		.get(itemA, itemB) as RelationRow | undefined;
	return row ? { itemAId: row.item_a_id, itemBId: row.item_b_id, createdAt: row.created_at } : null;
}

export type ItemRelationRepository = ItemRelationRepositoryPort;
