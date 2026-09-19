import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { listAppliedMigrations, runMigrations } from './migrate';

let tmpDir: string;
let dbPath: string;
let db: Database.Database;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-db-test-'));
	dbPath = path.join(tmpDir, 'test.sqlite');
});

afterEach(() => {
	db?.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('openDatabase / migrations', () => {
	it('applies migrations from scratch on a fresh file', () => {
		db = openDatabase(dbPath);
		const applied = listAppliedMigrations(db);
		expect(applied).toContain('0001_init');
	});

	it('is idempotent: re-running migrations on an already-migrated db applies nothing new', () => {
		db = openDatabase(dbPath);
		const firstRun = listAppliedMigrations(db);

		const result = runMigrations(db);
		expect(result.applied).toEqual([]);
		expect(listAppliedMigrations(db)).toEqual(firstRun);
	});

	it('reopening the same file preserves data and does not re-apply migrations', () => {
		db = openDatabase(dbPath);
		db.close();

		db = openDatabase(dbPath);
		expect(listAppliedMigrations(db)).toContain('0001_init');
	});

	it('sets the required startup pragmas', () => {
		db = openDatabase(dbPath);
		expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
		expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
		expect(db.pragma('synchronous', { simple: true })).toBe(1); // NORMAL = 1
	});

	it('creates all expected tables', () => {
		db = openDatabase(dbPath);
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.all()
			.map((r) => (r as { name: string }).name);
		expect(tables).toEqual(
			expect.arrayContaining([
				'action_dependencies',
				'actions',
				'app_settings',
				'cycle_fields',
				'cycles',
				'events',
				'item_relations',
				'items',
				'notification_deliveries',
				'schema_migrations'
			])
		);
	});
});

function insertItem(database: Database.Database, id = 'item-1') {
	const now = new Date().toISOString();
	database
		.prepare(
			`INSERT INTO items (id, title, status, created_at, updated_at) VALUES (?, 'Test item', 'ACTIVE', ?, ?)`
		)
		.run(id, now, now);
	return id;
}

function insertCycle(
	database: Database.Database,
	itemId: string,
	id = 'cycle-1',
	status = 'ACTIVE',
	sequence = 1
) {
	database
		.prepare(
			`INSERT INTO cycles (id, item_id, sequence, status, created_at) VALUES (?, ?, ?, ?, ?)`
		)
		.run(id, itemId, sequence, status, new Date().toISOString());
	return id;
}

describe('schema constraints', () => {
	beforeEach(() => {
		db = openDatabase(dbPath);
	});

	it('rejects an item with a blank title', () => {
		const now = new Date().toISOString();
		expect(() =>
			db
				.prepare(
					`INSERT INTO items (id, title, status, created_at, updated_at) VALUES ('i', '   ', 'ACTIVE', ?, ?)`
				)
				.run(now, now)
		).toThrow();
	});

	it('rejects a second ACTIVE cycle for the same item (partial unique index)', () => {
		const itemId = insertItem(db);
		insertCycle(db, itemId, 'cycle-1', 'ACTIVE', 1);
		expect(() => insertCycle(db, itemId, 'cycle-2', 'ACTIVE', 2)).toThrow();
	});

	it('allows a COMPLETED cycle to coexist with an ACTIVE one', () => {
		const itemId = insertItem(db);
		insertCycle(db, itemId, 'cycle-1', 'COMPLETED', 1);
		expect(() => insertCycle(db, itemId, 'cycle-2', 'ACTIVE', 2)).not.toThrow();
	});

	it('cascades delete from item to cycle to fields/events/actions/dependencies', () => {
		const itemId = insertItem(db);
		const cycleId = insertCycle(db, itemId);
		db.prepare(
			`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, position) VALUES ('f1', ?, 'k', 'L', 'text', 'PLAYBOOK', 0)`
		).run(cycleId);
		db.prepare(
			`INSERT INTO events (id, cycle_id, event_key, label, source_field_key, position) VALUES ('e1', ?, 'k', 'L', 'k', 0)`
		).run(cycleId);
		db.prepare(
			`INSERT INTO actions (id, cycle_id, action_key, label, state, due_kind, position, created_at) VALUES ('a1', ?, 'k', 'L', 'OPEN', 'NONE', 0, ?)`
		).run(cycleId, new Date().toISOString());
		db.prepare(
			`INSERT INTO actions (id, cycle_id, action_key, label, state, due_kind, position, created_at) VALUES ('a2', ?, 'k2', 'L2', 'OPEN', 'NONE', 1, ?)`
		).run(cycleId, new Date().toISOString());
		db.prepare(
			`INSERT INTO action_dependencies (action_id, depends_on_action_id) VALUES ('a2', 'a1')`
		).run();

		db.prepare(`DELETE FROM items WHERE id = ?`).run(itemId);

		expect(db.prepare('SELECT COUNT(*) AS n FROM cycles').get()).toEqual({ n: 0 });
		expect(db.prepare('SELECT COUNT(*) AS n FROM cycle_fields').get()).toEqual({ n: 0 });
		expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 0 });
		expect(db.prepare('SELECT COUNT(*) AS n FROM actions').get()).toEqual({ n: 0 });
		expect(db.prepare('SELECT COUNT(*) AS n FROM action_dependencies').get()).toEqual({ n: 0 });
	});

	it('rejects a self-dependency at the database level too', () => {
		const itemId = insertItem(db);
		const cycleId = insertCycle(db, itemId);
		db.prepare(
			`INSERT INTO actions (id, cycle_id, action_key, label, state, due_kind, position, created_at) VALUES ('a1', ?, 'k', 'L', 'OPEN', 'NONE', 0, ?)`
		).run(cycleId, new Date().toISOString());
		expect(() =>
			db
				.prepare(
					`INSERT INTO action_dependencies (action_id, depends_on_action_id) VALUES ('a1', 'a1')`
				)
				.run()
		).toThrow();
	});

	it('enforces canonical, distinct, existing item relation pairs', () => {
		insertItem(db, 'a');
		insertItem(db, 'b');
		expect(() =>
			db.prepare("INSERT INTO item_relations VALUES ('a', 'b', 'now')").run()
		).not.toThrow();
		expect(() => db.prepare("INSERT INTO item_relations VALUES ('b', 'a', 'now')").run()).toThrow();
		expect(() => db.prepare("INSERT INTO item_relations VALUES ('a', 'a', 'now')").run()).toThrow();
		expect(() =>
			db.prepare("INSERT INTO item_relations VALUES ('a', 'missing', 'now')").run()
		).toThrow();
	});

	describe('due_kind / due_event_key / due_offset consistency', () => {
		function insertAction(overrides: {
			dueKind: string;
			dueEventKey?: string | null;
			dueOffset?: string | null;
			dueDate?: string | null;
		}) {
			const itemId = insertItem(db, `item-${Math.random()}`);
			const cycleId = insertCycle(db, itemId, `cycle-${Math.random()}`);
			return db
				.prepare(
					`INSERT INTO actions (id, cycle_id, action_key, label, state, due_kind, due_event_key, due_offset, due_date, position, created_at)
					 VALUES (?, ?, 'k', 'L', 'OPEN', ?, ?, ?, ?, 0, ?)`
				)
				.run(
					`a-${Math.random()}`,
					cycleId,
					overrides.dueKind,
					overrides.dueEventKey ?? null,
					overrides.dueOffset ?? null,
					overrides.dueDate ?? null,
					new Date().toISOString()
				);
		}

		it('rejects DERIVED without a due_event_key', () => {
			expect(() => insertAction({ dueKind: 'DERIVED', dueEventKey: null })).toThrow();
		});

		it('accepts DERIVED with a due_event_key', () => {
			expect(() => insertAction({ dueKind: 'DERIVED', dueEventKey: 'expiry' })).not.toThrow();
		});

		it('rejects NONE with a due_date set', () => {
			expect(() => insertAction({ dueKind: 'NONE', dueDate: '2026-01-01' })).toThrow();
		});

		it('accepts NONE with no due_date', () => {
			expect(() => insertAction({ dueKind: 'NONE' })).not.toThrow();
		});

		it('rejects MANUAL with a due_offset set', () => {
			expect(() => insertAction({ dueKind: 'MANUAL', dueOffset: '{"months":1}' })).toThrow();
		});

		it('accepts MANUAL with an optional due_date and no offset', () => {
			expect(() => insertAction({ dueKind: 'MANUAL', dueDate: '2026-01-01' })).not.toThrow();
			expect(() => insertAction({ dueKind: 'MANUAL' })).not.toThrow();
		});
	});

	describe('completed_at / state consistency', () => {
		function insertAction(state: string, completedAt: string | null) {
			const itemId = insertItem(db, `item-${Math.random()}`);
			const cycleId = insertCycle(db, itemId, `cycle-${Math.random()}`);
			return db
				.prepare(
					`INSERT INTO actions (id, cycle_id, action_key, label, state, due_kind, position, created_at, completed_at)
					 VALUES (?, ?, 'k', 'L', ?, 'NONE', 0, ?, ?)`
				)
				.run(`a-${Math.random()}`, cycleId, state, new Date().toISOString(), completedAt);
		}

		it('rejects OPEN with a completed_at timestamp', () => {
			expect(() => insertAction('OPEN', new Date().toISOString())).toThrow();
		});

		it('rejects DONE without a completed_at timestamp', () => {
			expect(() => insertAction('DONE', null)).toThrow();
		});

		it('rejects SKIPPED without a completed_at timestamp', () => {
			expect(() => insertAction('SKIPPED', null)).toThrow();
		});

		it('accepts OPEN with no completed_at', () => {
			expect(() => insertAction('OPEN', null)).not.toThrow();
		});

		it('accepts DONE with a completed_at timestamp', () => {
			expect(() => insertAction('DONE', new Date().toISOString())).not.toThrow();
		});

		it('accepts SKIPPED with a completed_at timestamp', () => {
			expect(() => insertAction('SKIPPED', new Date().toISOString())).not.toThrow();
		});
	});

	describe('attachments', () => {
		function insertAttachment(overrides: {
			filename?: string;
			mimeType?: string;
			byteSize?: number;
			sha256?: string;
			storageKey?: string;
		}) {
			const itemId = insertItem(db, `item-${Math.random()}`);
			return db
				.prepare(
					`INSERT INTO attachments (id, item_id, filename, storage_key, mime_type, byte_size, sha256, uploaded_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.run(
					`att-${Math.random()}`,
					itemId,
					overrides.filename ?? 'a.pdf',
					overrides.storageKey ?? `ab/${Math.random()}`,
					overrides.mimeType ?? 'application/pdf',
					overrides.byteSize ?? 10,
					overrides.sha256 ?? 'a'.repeat(64),
					new Date().toISOString()
				);
		}

		it('rejects a blank filename', () => {
			expect(() => insertAttachment({ filename: '   ' })).toThrow();
		});

		it('rejects a byte_size of 0', () => {
			expect(() => insertAttachment({ byteSize: 0 })).toThrow();
		});

		it('rejects a mime_type outside the allow-list', () => {
			expect(() => insertAttachment({ mimeType: 'text/html' })).toThrow();
		});

		it('rejects a sha256 that is not exactly 64 characters', () => {
			expect(() => insertAttachment({ sha256: 'abc' })).toThrow();
		});

		it('rejects a duplicate storage_key across different items', () => {
			insertAttachment({ storageKey: 'ab/shared-key' });
			expect(() => insertAttachment({ storageKey: 'ab/shared-key' })).toThrow();
		});
	});

	describe('notification_deliveries', () => {
		function insertDelivery(
			overrides: {
				kind?: string;
				status?: string;
				sentAt?: string | null;
				channel?: string;
			} = {}
		) {
			const itemId = insertItem(db, `notification-item-${Math.random()}`);
			const cycleId = insertCycle(db, itemId, `notification-cycle-${Math.random()}`);
			const actionId = `notification-action-${Math.random()}`;
			db.prepare(
				`INSERT INTO actions (id, cycle_id, action_key, label, state, due_kind, position, created_at)
				 VALUES (?, ?, 'notification', 'Notification', 'OPEN', 'MANUAL', 0, ?)`
			).run(actionId, cycleId, new Date().toISOString());
			return () =>
				db
					.prepare(
						`INSERT INTO notification_deliveries
					 (id, item_id, action_id, kind, target_date, channel, status, attempts, created_at, sent_at)
					 VALUES (?, ?, ?, ?, '2026-06-10', ?, ?, 0, ?, ?)`
					)
					.run(
						`delivery-${Math.random()}`,
						itemId,
						actionId,
						overrides.kind ?? 'DUE_SOON',
						overrides.channel ?? 'NTFY',
						overrides.status ?? 'PENDING',
						new Date().toISOString(),
						overrides.sentAt ?? null
					);
		}

		it('rejects an unknown reminder kind', () => {
			expect(() => insertDelivery({ kind: 'INVALID' })()).toThrow();
		});

		it('requires sent_at exactly for SENT deliveries', () => {
			expect(() => insertDelivery({ status: 'SENT' })()).toThrow();
			expect(() =>
				insertDelivery({ status: 'PENDING', sentAt: new Date().toISOString() })()
			).toThrow();
		});

		it('rejects an unknown delivery channel', () => {
			expect(() => insertDelivery({ channel: 'EMAIL' })()).toThrow();
		});
	});

	describe('extraction_runs / extraction_suggestions', () => {
		function insertRun(overrides: { status?: string; reviewedAt?: string | null } = {}) {
			const itemId = insertItem(db, `item-${Math.random()}`);
			const cycleId = insertCycle(db, itemId, `cycle-${Math.random()}`);
			const insertAttachment = `INSERT INTO attachments
				(id, item_id, filename, storage_key, mime_type, byte_size, sha256, uploaded_at)
				VALUES ('att-1', ?, 'a.pdf', 'ab/att-1', 'application/pdf', 10, ?, ?)`;
			db.prepare(insertAttachment).run(itemId, 'a'.repeat(64), new Date().toISOString());
			const runId = `run-${Math.random()}`;
			const insertRunSql = `INSERT INTO extraction_runs
				(id, item_id, cycle_id, attachment_id, provider_id, model_id, status, created_at, reviewed_at)
				VALUES (?, ?, ?, 'att-1', 'fake', 'fake-v1', ?, ?, ?)`;
			const args = [
				runId,
				itemId,
				cycleId,
				overrides.status ?? 'RUNNING',
				new Date().toISOString(),
				overrides.reviewedAt ?? null
			];
			db.prepare(insertRunSql).run(...args);
			return runId;
		}

		it('rejects a status outside the five known states', () => {
			expect(() => insertRun({ status: 'BOGUS' })).toThrow();
		});

		it('rejects a NEW run with reviewed_at already set', () => {
			expect(() => insertRun({ status: 'NEW', reviewedAt: new Date().toISOString() })).toThrow();
		});

		it('rejects an APPLIED run with no reviewed_at', () => {
			expect(() => insertRun({ status: 'APPLIED', reviewedAt: null })).toThrow();
		});

		it('accepts a DISMISSED run with reviewed_at set', () => {
			expect(() =>
				insertRun({ status: 'DISMISSED', reviewedAt: new Date().toISOString() })
			).not.toThrow();
		});

		it('cascades delete from item to extraction_runs to extraction_suggestions', () => {
			const itemId = insertItem(db, `item-${Math.random()}`);
			const cycleId = insertCycle(db, itemId, `cycle-${Math.random()}`);
			db.prepare(
				`INSERT INTO attachments (id, item_id, filename, storage_key, mime_type, byte_size, sha256, uploaded_at)
				 VALUES ('att-2', ?, 'a.pdf', 'ab/att-2', 'application/pdf', 10, ?, ?)`
			).run(itemId, 'a'.repeat(64), new Date().toISOString());
			db.prepare(
				`INSERT INTO extraction_runs
				 (id, item_id, cycle_id, attachment_id, provider_id, model_id, status, created_at, reviewed_at)
				 VALUES ('run-cascade', ?, ?, 'att-2', 'fake', 'fake-v1', 'NEW', ?, NULL)`
			).run(itemId, cycleId, new Date().toISOString());
			db.prepare(
				`INSERT INTO extraction_suggestions (id, run_id, field_key, value, position)
				 VALUES ('sug-1', 'run-cascade', 'k', 'v', 0)`
			).run();

			db.prepare('DELETE FROM items WHERE id = ?').run(itemId);

			expect(db.prepare('SELECT COUNT(*) AS n FROM extraction_runs').get()).toEqual({ n: 0 });
			expect(db.prepare('SELECT COUNT(*) AS n FROM extraction_suggestions').get()).toEqual({
				n: 0
			});
		});

		it('rejects a second suggestion for the same run and field_key', () => {
			const runId = insertRun({ status: 'NEW' });
			db.prepare(
				`INSERT INTO extraction_suggestions (id, run_id, field_key, value, position) VALUES ('s1', ?, 'k', 'v1', 0)`
			).run(runId);
			const duplicateInsert = `INSERT INTO extraction_suggestions (id, run_id, field_key, value, position) VALUES ('s2', ?, 'k', 'v2', 1)`;
			expect(() => db.prepare(duplicateInsert).run(runId)).toThrow();
		});
	});
});
