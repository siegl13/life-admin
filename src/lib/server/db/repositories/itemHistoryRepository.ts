import type Database from 'better-sqlite3';
import type { ItemHistoryEvent } from '$lib/application/ports';

export function insert(db: Database.Database, event: ItemHistoryEvent): void {
	db.prepare(
		`INSERT INTO item_history_events (id, item_id, actor_kind, event_type, payload, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).run(event.id, event.itemId, event.actorKind, event.eventType, event.payload, event.createdAt);
}

export function listByItem(
	db: Database.Database,
	itemId: string,
	limit: number,
	offset: number
): ItemHistoryEvent[] {
	return db
		.prepare(
			`SELECT id, item_id AS itemId, actor_kind AS actorKind, event_type AS eventType,
			        payload, created_at AS createdAt
			 FROM item_history_events
			 WHERE item_id = ?
			 ORDER BY created_at DESC, id DESC
			 LIMIT ? OFFSET ?`
		)
		.all(itemId, limit, offset) as ItemHistoryEvent[];
}

export function countByItem(db: Database.Database, itemId: string): number {
	const row = db
		.prepare(`SELECT COUNT(*) AS count FROM item_history_events WHERE item_id = ?`)
		.get(itemId) as { count: number };
	return row.count;
}

export function deleteForItem(db: Database.Database, itemId: string): number {
	const result = db.prepare(`DELETE FROM item_history_events WHERE item_id = ?`).run(itemId);
	return result.changes;
}
