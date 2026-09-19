import type Database from 'better-sqlite3';
import type { Cycle, CycleStatus } from '$lib/domain/cycle/cycle';
import type { StartNextCycleInput } from '$lib/application/ports';
import crypto from 'node:crypto';
import { applyFieldUpdatesAndRecalculate } from './scheduleRepository';
import { touchItem } from './itemRepository';
import { insertCycleContents } from './cycleContents';

/** Thrown when the cycle `startNextCycle` was asked to complete is no
 *  longer ACTIVE (already completed by a concurrent/duplicate submit, e.g.
 *  a double-click). The `AND status = 'ACTIVE'` guard on the UPDATE makes
 *  this fail loudly instead of creating a third cycle. */
export class CycleNoLongerActiveError extends Error {}

interface CycleRow {
	id: string;
	item_id: string;
	sequence: number;
	status: string;
	created_at: string;
	playbook_version: string | null;
	completed_at: string | null;
}

function mapCycle(row: CycleRow): Cycle {
	return {
		id: row.id,
		itemId: row.item_id,
		sequence: row.sequence,
		status: row.status as CycleStatus,
		createdAt: row.created_at,
		playbookVersion: row.playbook_version,
		completedAt: row.completed_at
	};
}

export function listCycles(db: Database.Database, itemId: string): Cycle[] {
	return (
		db
			.prepare('SELECT * FROM cycles WHERE item_id=? ORDER BY sequence DESC')
			.all(itemId) as CycleRow[]
	).map(mapCycle);
}
export function startNextCycle(db: Database.Database, input: StartNextCycleInput): Cycle {
	const id = crypto.randomUUID(),
		now = new Date().toISOString();
	db.transaction(() => {
		const changed = db
			.prepare(
				"UPDATE cycles SET status='COMPLETED',completed_at=? WHERE id=? AND item_id=? AND status='ACTIVE'"
			)
			.run(now, input.completingCycleId, input.itemId);
		if (changed.changes !== 1) throw new CycleNoLongerActiveError();
		const sequence = (
			db
				.prepare('SELECT COALESCE(MAX(sequence),0)+1 n FROM cycles WHERE item_id=?')
				.get(input.itemId) as { n: number }
		).n;
		db.prepare(
			"INSERT INTO cycles(id,item_id,sequence,status,created_at,playbook_version) VALUES(?,?,?,'ACTIVE',?,?)"
		).run(id, input.itemId, sequence, now, input.playbookVersion);
		insertCycleContents(
			db,
			id,
			{ fields: input.fields, events: input.events, actions: input.actions },
			now
		);
		applyFieldUpdatesAndRecalculate(
			db,
			id,
			input.fields.map((f) => ({ fieldKey: f.fieldKey, value: f.value }))
		);
		touchItem(db, input.itemId, now);
	})();
	return listCycles(db, input.itemId).find((c) => c.id === id)!;
}

/**
 * Returns an item's current cycle. An item can have several cycles once
 * `startNextCycle` (Slice 8) has run, but exactly one is ever ACTIVE at a
 * time (enforced by the partial unique index `ux_cycles_single_active`),
 * so this is always well-defined.
 */
export function getActiveCycle(db: Database.Database, itemId: string): Cycle | null {
	const row = db
		.prepare(`SELECT * FROM cycles WHERE item_id = ? AND status = 'ACTIVE'`)
		.get(itemId) as CycleRow | undefined;
	return row ? mapCycle(row) : null;
}
