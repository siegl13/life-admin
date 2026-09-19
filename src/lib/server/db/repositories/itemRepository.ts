import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Item, ItemStatus } from '$lib/domain/item/item';
import type { CreateItemInput } from '$lib/application/ports';
import { insertCycleContents } from './cycleContents';

interface ItemRow {
	id: string;
	title: string;
	note: string | null;
	status: string;
	playbook_id: string | null;
	playbook_version: string | null;
	playbook_name: string | null;
	playbook_snapshot: string | null;
	created_at: string;
	updated_at: string;
	archived_at: string | null;
}

/** items.playbook_snapshot is untrusted persisted data (a restored backup
 *  can be hand-edited or truncated) — JSON.parse() throwing here must
 *  never become an uncaught crash for /items or an item's detail page.
 *  See the Slice 8 review, finding 3. */
function parseStoredSnapshot(raw: string | null): {
	playbookSnapshot: unknown | null;
	playbookSnapshotCorrupted: boolean;
} {
	if (raw === null) return { playbookSnapshot: null, playbookSnapshotCorrupted: false };
	try {
		return { playbookSnapshot: JSON.parse(raw), playbookSnapshotCorrupted: false };
	} catch {
		return { playbookSnapshot: null, playbookSnapshotCorrupted: true };
	}
}

function mapItem(row: ItemRow): Item {
	const { playbookSnapshot, playbookSnapshotCorrupted } = parseStoredSnapshot(
		row.playbook_snapshot
	);
	return {
		id: row.id,
		title: row.title,
		note: row.note,
		status: row.status as ItemStatus,
		playbookId: row.playbook_id,
		playbookVersion: row.playbook_version,
		playbookName: row.playbook_name,
		playbookSnapshot,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		archivedAt: row.archived_at,
		playbookSnapshotCorrupted
	};
}

/**
 * Creates an item together with its first (and only, in V1) cycle and
 * every field/event/action/dependency the materialization plan calls for
 * — all in one transaction. An item is always fully materialized at
 * creation, even though the UI only exposes actions from Slice 3 onward:
 * this means no later slice ever needs to backfill existing items.
 */
export function createItemInTransaction(db: Database.Database, input: CreateItemInput): Item {
	const itemId = crypto.randomUUID();
	const cycleId = crypto.randomUUID();
	const now = new Date().toISOString();
	const title = input.title.trim();

	db.prepare(
		`INSERT INTO items (id, title, note, status, playbook_id, playbook_version, playbook_name, playbook_snapshot, created_at, updated_at)
		 VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`
	).run(
		itemId,
		title,
		input.note ?? null,
		input.playbook?.id ?? null,
		input.playbook?.version ?? null,
		input.playbook?.name ?? null,
		input.playbook ? JSON.stringify(input.playbook.snapshot) : null,
		now,
		now
	);

	db.prepare(
		`INSERT INTO cycles (id, item_id, sequence, status, created_at, playbook_version)
		 VALUES (?, ?, 1, 'ACTIVE', ?, ?)`
	).run(cycleId, itemId, now, input.playbook?.version ?? null);

	insertCycleContents(
		db,
		cycleId,
		{
			fields: input.materialization.fields.map((field) => ({ ...field, value: null })),
			events: input.materialization.events,
			actions: input.materialization.actions
		},
		now
	);

	return getItemById(db, itemId)!;
}

export function createItem(db: Database.Database, input: CreateItemInput): Item {
	return db.transaction(() => createItemInTransaction(db, input))();
}

export function getItemById(db: Database.Database, id: string): Item | null {
	const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
	return row ? mapItem(row) : null;
}

export function listItems(db: Database.Database, status: ItemStatus = 'ACTIVE'): Item[] {
	// rowid breaks ties deterministically when two items share the same
	// created_at millisecond (created_at alone is not a reliable total
	// order at high creation rates).
	const rows = db
		.prepare('SELECT * FROM items WHERE status = ? ORDER BY created_at DESC, rowid DESC')
		.all(status) as ItemRow[];
	return rows.map(mapItem);
}

export function touchItem(db: Database.Database, id: string, now = new Date().toISOString()): void {
	db.prepare('UPDATE items SET updated_at = ? WHERE id = ?').run(now, id);
}

export function setItemStatus(db: Database.Database, id: string, status: ItemStatus): Item {
	const now = new Date().toISOString();
	db.prepare('UPDATE items SET status=?,archived_at=?,updated_at=? WHERE id=?').run(
		status,
		status === 'ARCHIVED' ? now : null,
		now,
		id
	);
	return getItemById(db, id)!;
}
