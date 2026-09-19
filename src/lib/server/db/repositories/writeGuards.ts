import type Database from 'better-sqlite3';

/**
 * Thrown by every repository write below when the item/cycle a mutation
 * targets is not currently writable (archived item, or — for cycle-scoped
 * writes — a cycle that is no longer the item's ACTIVE one). One shared
 * error/message for every reason, deliberately: the caller must not be
 * able to distinguish "wrong item", "archived", "inactive cycle" or "stale
 * id" from the response (see the Slice 8 review, finding 1 and finding 2).
 */
export class ItemNotWritableError extends Error {
	constructor() {
		super('Item is not currently writable');
		this.name = 'ItemNotWritableError';
	}
}

/**
 * Throws unless `cycleId` is right now the ACTIVE cycle of an ACTIVE item.
 * Callers must call this as the FIRST statement inside the same
 * `db.transaction()` as the write it guards, with no `await` anywhere in
 * that closure — better-sqlite3 is synchronous and Node is single
 * threaded, so nothing can run between this check and the write that
 * follows it in the same transaction closure. An early, separate check
 * before async work (parsing a request body, streaming a file) is a UX
 * nicety, never a substitute for this (Slice 8 review, finding 2).
 */
export function assertCycleIsWritable(db: Database.Database, cycleId: string): void {
	const row = db
		.prepare(
			`SELECT 1 FROM cycles c
			 JOIN items i ON i.id = c.item_id
			 WHERE c.id = ? AND c.status = 'ACTIVE' AND i.status = 'ACTIVE'`
		)
		.get(cycleId);
	if (!row) throw new ItemNotWritableError();
}

/** Same guarantee as {@link assertCycleIsWritable}, for writes that are
 *  scoped to an item directly rather than to one of its cycles
 *  (attachments: they outlive any single cycle). */
export function assertItemIsWritable(db: Database.Database, itemId: string): void {
	const row = db.prepare(`SELECT 1 FROM items WHERE id = ? AND status = 'ACTIVE'`).get(itemId);
	if (!row) throw new ItemNotWritableError();
}
