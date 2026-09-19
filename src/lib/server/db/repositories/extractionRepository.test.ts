import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import {
	addAdditionalFields,
	applyRun,
	claimRun,
	dismissRun,
	findNewestPendingRun,
	getById,
	listAdditionalSuggestions,
	listSuggestions,
	markFailed,
	markSucceeded
} from './extractionRepository';
import {
	AdditionalSuggestionNotFoundError,
	DailyExtractionLimitReachedError,
	ExtractionRunNotReviewableError
} from '$lib/application/ai/ports';
import { ItemNotWritableError } from './writeGuards';
import { createItem } from './itemRepository';
import { listEvents } from './eventRepository';
import { listActions } from './actionRepository';
import { materializePlaybook } from '$lib/domain/playbook/materialize';
import { normalizePlaybook } from '$lib/domain/playbook/normalize';
import { parsePlaybookStructure } from '$lib/domain/playbook/schema';
import { Worker } from 'node:worker_threads';

function raceClaimInWorker(input: {
	dbPath: string;
	id: string;
	itemId: string;
	cycleId: string;
	attachmentId: string;
	sourceFilename: string;
	providerId: string;
	modelId: string;
	createdAt: string;
	windowStartIso: string;
	dailyLimit: number;
}): Promise<string> {
	return new Promise((resolve) => {
		const worker = new Worker(
			new URL('./extractionRepository.claimRunWorker.ts', import.meta.url),
			{ workerData: input, execArgv: ['--import', 'tsx'] }
		);
		worker.once('message', (outcome: string) => {
			resolve(outcome);
			void worker.terminate();
		});
		worker.once('error', (err: Error) => {
			resolve('ERROR:' + err.message);
			void worker.terminate();
		});
	});
}

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-extraction-repo-'));
	db = openDatabase(path.join(tmpDir, 'test.sqlite'));
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function insertItem(id = `item-${crypto.randomUUID()}`) {
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO items (id, title, status, created_at, updated_at) VALUES (?, 'Test item', 'ACTIVE', ?, ?)`
	).run(id, now, now);
	return id;
}

function insertCycle(itemId: string, id = `cycle-${crypto.randomUUID()}`, sequence = 1) {
	db.prepare(
		`INSERT INTO cycles (id, item_id, sequence, status, created_at) VALUES (?, ?, ?, 'ACTIVE', ?)`
	).run(id, itemId, sequence, new Date().toISOString());
	return id;
}

function insertField(
	cycleId: string,
	fieldKey: string,
	type: 'text' | 'date',
	value: string | null
) {
	db.prepare(
		`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, position, value)
		 VALUES (?, ?, ?, ?, ?, 'PLAYBOOK', 0, ?)`
	).run(crypto.randomUUID(), cycleId, fieldKey, fieldKey, type, value);
}

function insertAttachment(itemId: string, id = `att-${crypto.randomUUID()}`) {
	db.prepare(
		`INSERT INTO attachments (id, item_id, filename, storage_key, mime_type, byte_size, sha256, uploaded_at)
		 VALUES (?, ?, 'a.pdf', ?, 'application/pdf', 10, ?, ?)`
	).run(id, itemId, `ab/${crypto.randomUUID()}`, 'a'.repeat(64), new Date().toISOString());
	return id;
}

function fixture() {
	const itemId = insertItem();
	const cycleId = insertCycle(itemId);
	const attachmentId = insertAttachment(itemId);
	insertField(cycleId, 'contract_end', 'date', null);
	return { itemId, cycleId, attachmentId };
}

describe('claimRun', () => {
	it('inserts a RUNNING row counted from now on', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		const now = new Date().toISOString();
		claimRun(db, {
			id: 'run-1',
			itemId,
			cycleId,
			attachmentId,
			sourceFilename: 'a.pdf',
			providerId: 'fake',
			modelId: 'fake-v1',
			createdAt: now,
			windowStartIso: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
			dailyLimit: 20
		});
		const run = getById(db, 'run-1');
		expect(run?.status).toBe('RUNNING');
	});

	it('rejects once the rolling-window count reaches the daily limit', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		const now = new Date().toISOString();
		const windowStartIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		claimRun(db, {
			id: 'run-1',
			itemId,
			cycleId,
			attachmentId,
			sourceFilename: 'a.pdf',
			providerId: 'fake',
			modelId: 'fake-v1',
			createdAt: now,
			windowStartIso,
			dailyLimit: 1
		});
		expect(() =>
			claimRun(db, {
				id: 'run-2',
				itemId,
				cycleId,
				attachmentId,
				providerId: 'fake',
				modelId: 'fake-v1',
				createdAt: now,
				windowStartIso,
				dailyLimit: 1
			})
		).toThrow(DailyExtractionLimitReachedError);
	});

	it('a FAILED run still counts toward the rolling window', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		const now = new Date().toISOString();
		const windowStartIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		claimRun(db, {
			id: 'run-1',
			itemId,
			cycleId,
			attachmentId,
			providerId: 'fake',
			modelId: 'fake-v1',
			createdAt: now,
			windowStartIso,
			dailyLimit: 1
		});
		markFailed(db, 'run-1');
		expect(() =>
			claimRun(db, {
				id: 'run-2',
				itemId,
				cycleId,
				attachmentId,
				providerId: 'fake',
				modelId: 'fake-v1',
				createdAt: now,
				windowStartIso,
				dailyLimit: 1
			})
		).toThrow(DailyExtractionLimitReachedError);
	});

	it('deleting the source attachment does not remove the run or reset the daily count (ON DELETE SET NULL, not CASCADE)', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		const now = new Date().toISOString();
		const windowStartIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		claimRun(db, {
			id: 'run-1',
			itemId,
			cycleId,
			attachmentId,
			sourceFilename: 'a.pdf',
			providerId: 'fake',
			modelId: 'fake-v1',
			createdAt: now,
			windowStartIso,
			dailyLimit: 1
		});

		db.prepare('DELETE FROM attachments WHERE id = ?').run(attachmentId);

		const run = getById(db, 'run-1');
		expect(run).not.toBeNull();
		expect(run!.status).toBe('RUNNING');
		expect(run!.attachmentId).toBeNull();
		expect(run!.sourceFilename).toBe('a.pdf');

		// The daily cap must still see this attempt: a delete-and-re-upload
		// cycle must not be a way to bypass the rolling 24h limit.
		expect(() =>
			claimRun(db, {
				id: 'run-2',
				itemId,
				cycleId,
				attachmentId: insertAttachment(itemId),
				providerId: 'fake',
				modelId: 'fake-v1',
				createdAt: now,
				windowStartIso,
				dailyLimit: 1
			})
		).toThrow(DailyExtractionLimitReachedError);
	});

	it('a claimed run survives attachment deletion in-flight and can still be marked succeeded', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		claimRun(db, {
			id: 'run-1',
			itemId,
			cycleId,
			attachmentId,
			providerId: 'fake',
			modelId: 'fake-v1',
			createdAt: new Date().toISOString(),
			windowStartIso: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
			dailyLimit: 20
		});

		// Simulates the attachment being deleted while the provider call for
		// this exact run is still in flight.
		db.prepare('DELETE FROM attachments WHERE id = ?').run(attachmentId);

		markSucceeded(db, 'run-1', {
			suggestions: [{ fieldKey: 'contract_end', value: '2031-03-15', position: 0 }],
			discardedCount: 0,
			additionalSuggestions: [],
			discardedAdditionalCount: 0
		});

		const run = getById(db, 'run-1')!;
		expect(run.status).toBe('NEW');
		expect(listSuggestions(db, 'run-1')).toHaveLength(1);
	});

	it('a run created before the rolling window starts does not count', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		const oldCreatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
		db.prepare(
			`INSERT INTO extraction_runs (id, item_id, cycle_id, attachment_id, provider_id, model_id, status, created_at, reviewed_at)
			 VALUES ('run-old', ?, ?, ?, 'fake', 'fake-v1', 'FAILED', ?, NULL)`
		).run(itemId, cycleId, attachmentId, oldCreatedAt);

		expect(() =>
			claimRun(db, {
				id: 'run-new',
				itemId,
				cycleId,
				attachmentId,
				providerId: 'fake',
				modelId: 'fake-v1',
				createdAt: new Date().toISOString(),
				windowStartIso: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
				dailyLimit: 1
			})
		).not.toThrow();
	});

	it('rejects a second claim for the final slot even when issued back to back (single-connection serialization proof)', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		const now = new Date().toISOString();
		const windowStartIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		const claim = (id: string) =>
			claimRun(db, {
				id,
				itemId,
				cycleId,
				attachmentId,
				providerId: 'fake',
				modelId: 'fake-v1',
				createdAt: now,
				windowStartIso,
				dailyLimit: 1
			});
		claim('run-a');
		let secondFailed = false;
		try {
			claim('run-b');
		} catch (e) {
			secondFailed = e instanceof DailyExtractionLimitReachedError;
		}
		expect(secondFailed).toBe(true);
		expect((db.prepare('SELECT COUNT(*) n FROM extraction_runs').get() as { n: number }).n).toBe(1);
	});

	it('a second, independent SQLite connection to the same file cannot claim the final slot while the first connection holds the write lock open (real cross-connection lock, not just repeated calls on one connection)', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		const now = new Date().toISOString();
		const windowStartIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

		// A genuinely separate `Database` instance pointed at the same file —
		// distinct from `db`, the connection every other test in this file
		// shares — so this exercises SQLite's own BEGIN IMMEDIATE write lock
		// across connections, the real mechanism the daily cap depends on in
		// a multi-connection scenario, rather than only this process's
		// ability to call one JS function after another on a single
		// connection (see review round-01's "single-connection" finding).
		const secondConnection = new Database(db.name);
		secondConnection.pragma('journal_mode = WAL');
		secondConnection.pragma('busy_timeout = 200');

		try {
			// Hold the primary connection's write lock open past the point
			// where the second connection attempts its own claim for the
			// same (dailyLimit: 1) slot.
			db.prepare('BEGIN IMMEDIATE').run();
			db.prepare(
				`INSERT INTO extraction_runs (id, item_id, cycle_id, attachment_id, provider_id, model_id, status, created_at, reviewed_at)
				 VALUES ('run-primary-connection', ?, ?, ?, 'fake', 'fake-v1', 'RUNNING', ?, NULL)`
			).run(itemId, cycleId, attachmentId, now);

			expect(() =>
				claimRun(secondConnection, {
					id: 'run-second-connection',
					itemId,
					cycleId,
					attachmentId,
					providerId: 'fake',
					modelId: 'fake-v1',
					createdAt: now,
					windowStartIso,
					dailyLimit: 1
				})
			).toThrow();
		} finally {
			db.prepare('COMMIT').run();
		}

		// Lock released: the second connection now genuinely sees the
		// primary connection's committed row and is correctly rejected by
		// the daily cap itself (not by a lock timeout) — the property this
		// test exists to prove, from a real second connection.
		expect(() =>
			claimRun(secondConnection, {
				id: 'run-second-connection-retry',
				itemId,
				cycleId,
				attachmentId,
				providerId: 'fake',
				modelId: 'fake-v1',
				createdAt: now,
				windowStartIso,
				dailyLimit: 1
			})
		).toThrow(DailyExtractionLimitReachedError);

		expect((db.prepare('SELECT COUNT(*) n FROM extraction_runs').get() as { n: number }).n).toBe(1);
		secondConnection.close();
	});

	it('two genuinely concurrent claim attempts, from two real OS threads with two separate connections, racing for the final slot: exactly one succeeds, one is rejected, and exactly one row exists', async () => {
		const { itemId, cycleId, attachmentId } = fixture();
		const now = new Date().toISOString();
		const windowStartIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		const base = {
			dbPath: db.name,
			itemId,
			cycleId,
			attachmentId,
			sourceFilename: 'a.pdf',
			providerId: 'fake',
			modelId: 'fake-v1',
			createdAt: now,
			windowStartIso,
			dailyLimit: 1
		};

		const outcomes = await Promise.all([
			raceClaimInWorker({ ...base, id: 'run-worker-a' }),
			raceClaimInWorker({ ...base, id: 'run-worker-b' })
		]);

		expect(outcomes.filter((o) => o === 'claimed')).toHaveLength(1);
		expect(outcomes.filter((o) => o === 'DAILY_LIMIT')).toHaveLength(1);
		expect((db.prepare('SELECT COUNT(*) n FROM extraction_runs').get() as { n: number }).n).toBe(1);
	}, 15_000);
});

describe('markSucceeded / markFailed', () => {
	it('moves RUNNING to NEW and persists kept suggestions', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		claimRunFor('run-1', itemId, cycleId, attachmentId);
		markSucceeded(db, 'run-1', {
			suggestions: [{ fieldKey: 'contract_end', value: '2031-03-15', position: 0 }],
			discardedCount: 2,
			additionalSuggestions: [],
			discardedAdditionalCount: 0
		});
		const run = getById(db, 'run-1')!;
		expect(run.status).toBe('NEW');
		expect(run.suggestedCount).toBe(1);
		expect(run.discardedCount).toBe(2);
		expect(listSuggestions(db, 'run-1')).toEqual([
			{ fieldKey: 'contract_end', value: '2031-03-15', position: 0, accepted: false }
		]);
	});

	it('moves RUNNING to FAILED and persists no suggestions', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		claimRunFor('run-1', itemId, cycleId, attachmentId);
		markFailed(db, 'run-1');
		expect(getById(db, 'run-1')!.status).toBe('FAILED');
		expect(listSuggestions(db, 'run-1')).toEqual([]);
	});

	function claimRunFor(id: string, itemId: string, cycleId: string, attachmentId: string) {
		claimRun(db, {
			id,
			itemId,
			cycleId,
			attachmentId,
			providerId: 'fake',
			modelId: 'fake-v1',
			createdAt: new Date().toISOString(),
			windowStartIso: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
			dailyLimit: 20
		});
	}
});

describe('findNewestPendingRun', () => {
	it('returns the newest NEW run for a cycle, or null', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		expect(findNewestPendingRun(db, cycleId)).toBeNull();

		db.prepare(
			`INSERT INTO extraction_runs (id, item_id, cycle_id, attachment_id, provider_id, model_id, status, created_at, reviewed_at)
			 VALUES ('run-1', ?, ?, ?, 'fake', 'fake-v1', 'NEW', '2026-01-01T00:00:00.000Z', NULL)`
		).run(itemId, cycleId, attachmentId);
		db.prepare(
			`INSERT INTO extraction_runs (id, item_id, cycle_id, attachment_id, provider_id, model_id, status, created_at, reviewed_at)
			 VALUES ('run-2', ?, ?, ?, 'fake', 'fake-v1', 'NEW', '2026-01-02T00:00:00.000Z', NULL)`
		).run(itemId, cycleId, attachmentId);

		expect(findNewestPendingRun(db, cycleId)?.id).toBe('run-2');
	});

	it('does not return a run bound to a different (e.g. rolled-over) cycle', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		// Simulates an actual rollover: the old cycle must stop being ACTIVE
		// before a new one can be (ux_cycles_single_active), same as
		// cycleRepository.startNextCycle does in production.
		db.prepare(`UPDATE cycles SET status = 'COMPLETED' WHERE id = ?`).run(cycleId);
		const otherCycleId = insertCycle(itemId, `other-cycle-${crypto.randomUUID()}`, 2);
		db.prepare(
			`INSERT INTO extraction_runs (id, item_id, cycle_id, attachment_id, provider_id, model_id, status, created_at, reviewed_at)
			 VALUES ('run-1', ?, ?, ?, 'fake', 'fake-v1', 'NEW', ?, NULL)`
		).run(itemId, cycleId, attachmentId, new Date().toISOString());
		expect(findNewestPendingRun(db, otherCycleId)).toBeNull();
	});
});

describe('applyRun (invariant: AI is never authoritative)', () => {
	function seedNewRun() {
		const { itemId, cycleId, attachmentId } = fixture();
		db.prepare(
			`INSERT INTO extraction_runs (id, item_id, cycle_id, attachment_id, provider_id, model_id, status, created_at, reviewed_at)
			 VALUES ('run-1', ?, ?, ?, 'fake', 'fake-v1', 'NEW', ?, NULL)`
		).run(itemId, cycleId, attachmentId, new Date().toISOString());
		db.prepare(
			`INSERT INTO extraction_suggestions (id, run_id, field_key, value, position) VALUES (?, 'run-1', 'contract_end', '2031-03-15', 0)`
		).run(crypto.randomUUID());
		return { itemId, cycleId, attachmentId };
	}

	/**
	 * A real playbook (via createItem/materializePlaybook, the same pattern
	 * scheduleRepository.test.ts uses) rather than the bare `contract_end`
	 * field the other applyRun cases use: this is what proves applyRun's
	 * `applyFieldUpdatesAndRecalculate` call actually recalculates a real
	 * Event and a real DERIVED Action's due date, not just that a
	 * `cycle_fields` row changes (see the review round-01 finding on this).
	 */
	function seedNewRunWithSchedule() {
		const parsed = parsePlaybookStructure({
			schemaVersion: 1,
			id: 'de.finance.nv-certificate',
			version: '1.0.0',
			name: 'NV certificate',
			fields: [{ key: 'valid_until', type: 'date', label: 'Valid until', recommended: true }],
			events: [{ key: 'expiry', label: 'Expiry', sourceField: 'valid_until' }],
			actions: [
				{
					key: 'request_new',
					label: 'Request new',
					due: { event: 'expiry', offset: { months: -2 } }
				}
			]
		});
		if (!parsed.success) throw new Error('fixture invalid');
		const playbook = normalizePlaybook(parsed.data);

		const item = createItem(db, {
			title: 'NV-Bescheinigung Max',
			note: null,
			playbook: {
				id: playbook.id,
				version: playbook.version,
				name: playbook.name,
				snapshot: playbook
			},
			materialization: materializePlaybook(playbook)
		});
		const cycleId = (
			db.prepare(`SELECT id FROM cycles WHERE item_id = ? AND status = 'ACTIVE'`).get(item.id) as {
				id: string;
			}
		).id;
		const attachmentId = insertAttachment(item.id);

		db.prepare(
			`INSERT INTO extraction_runs (id, item_id, cycle_id, attachment_id, provider_id, model_id, status, created_at, reviewed_at)
			 VALUES ('run-schedule', ?, ?, ?, 'fake', 'fake-v1', 'NEW', ?, NULL)`
		).run(item.id, cycleId, attachmentId, new Date().toISOString());
		db.prepare(
			`INSERT INTO extraction_suggestions (id, run_id, field_key, value, position) VALUES (?, 'run-schedule', 'valid_until', '2028-08-31', 0)`
		).run(crypto.randomUUID());

		return { itemId: item.id, cycleId };
	}

	it('recalculates a real Event and a real DERIVED Action to their exact dates, not just a field value', () => {
		const { itemId, cycleId } = seedNewRunWithSchedule();

		applyRun(db, {
			runId: 'run-schedule',
			itemId,
			cycleId,
			updates: [{ fieldKey: 'valid_until', value: '2028-08-31' }],
			acceptedFieldKeys: ['valid_until'],
			reviewedAt: new Date().toISOString()
		});

		expect(listEvents(db, cycleId).find((e) => e.eventKey === 'expiry')?.resolvedDate).toBe(
			'2028-08-31'
		);
		const requestNew = listActions(db, cycleId).find((a) => a.actionKey === 'request_new')!;
		expect(requestNew.dueDate).toBe('2028-06-30');
		expect(getById(db, 'run-schedule')!.status).toBe('APPLIED');
	});

	it('updates cycle_fields and recalculates in the same transaction, marks the run APPLIED', () => {
		const { itemId, cycleId } = seedNewRun();
		applyRun(db, {
			runId: 'run-1',
			itemId,
			cycleId,
			updates: [{ fieldKey: 'contract_end', value: '2031-03-15' }],
			acceptedFieldKeys: ['contract_end'],
			reviewedAt: new Date().toISOString()
		});

		const field = db
			.prepare('SELECT value FROM cycle_fields WHERE cycle_id = ? AND field_key = ?')
			.get(cycleId, 'contract_end') as { value: string };
		expect(field.value).toBe('2031-03-15');

		const run = getById(db, 'run-1')!;
		expect(run.status).toBe('APPLIED');
		expect(run.reviewedAt).not.toBeNull();

		const suggestions = listSuggestions(db, 'run-1');
		expect(suggestions.find((s) => s.fieldKey === 'contract_end')?.accepted).toBe(true);
	});

	it('is all-or-nothing: a rejected claim (wrong item) leaves the field completely untouched', () => {
		const { cycleId } = seedNewRun();
		expect(() =>
			applyRun(db, {
				runId: 'run-1',
				itemId: 'a-different-item',
				cycleId,
				updates: [{ fieldKey: 'contract_end', value: '2031-03-15' }],
				acceptedFieldKeys: ['contract_end'],
				reviewedAt: new Date().toISOString()
			})
		).toThrow(ExtractionRunNotReviewableError);

		const field = db
			.prepare('SELECT value FROM cycle_fields WHERE cycle_id = ? AND field_key = ?')
			.get(cycleId, 'contract_end') as { value: string | null };
		expect(field.value).toBeNull();
		expect(getById(db, 'run-1')!.status).toBe('NEW');
	});

	it('a double submit (already APPLIED) throws and applies nothing twice', () => {
		const { itemId, cycleId } = seedNewRun();
		applyRun(db, {
			runId: 'run-1',
			itemId,
			cycleId,
			updates: [{ fieldKey: 'contract_end', value: '2031-03-15' }],
			acceptedFieldKeys: ['contract_end'],
			reviewedAt: new Date().toISOString()
		});
		expect(() =>
			applyRun(db, {
				runId: 'run-1',
				itemId,
				cycleId,
				updates: [{ fieldKey: 'contract_end', value: '1999-01-01' }],
				acceptedFieldKeys: ['contract_end'],
				reviewedAt: new Date().toISOString()
			})
		).toThrow(ExtractionRunNotReviewableError);
		const field = db
			.prepare('SELECT value FROM cycle_fields WHERE cycle_id = ? AND field_key = ?')
			.get(cycleId, 'contract_end') as { value: string };
		expect(field.value).toBe('2031-03-15');
	});

	it('rejects for the wrong item/cycle (a run bound to a different item)', () => {
		const { cycleId } = seedNewRun();
		expect(() =>
			applyRun(db, {
				runId: 'run-1',
				itemId: 'a-different-item',
				cycleId,
				updates: [],
				acceptedFieldKeys: [],
				reviewedAt: new Date().toISOString()
			})
		).toThrow(ExtractionRunNotReviewableError);
	});

	it('throws ItemNotWritableError and leaves the run NEW when the item was archived after the run became NEW', () => {
		const { itemId, cycleId } = seedNewRun();
		db.prepare(`UPDATE items SET status = 'ARCHIVED' WHERE id = ?`).run(itemId);

		expect(() =>
			applyRun(db, {
				runId: 'run-1',
				itemId,
				cycleId,
				updates: [{ fieldKey: 'contract_end', value: '2031-03-15' }],
				acceptedFieldKeys: ['contract_end'],
				reviewedAt: new Date().toISOString()
			})
		).toThrow(ItemNotWritableError);

		const field = db
			.prepare('SELECT value FROM cycle_fields WHERE cycle_id = ? AND field_key = ?')
			.get(cycleId, 'contract_end') as { value: string | null };
		expect(field.value).toBeNull();
		expect(getById(db, 'run-1')!.status).toBe('NEW');
	});

	it('accepting nothing still marks the run APPLIED, with no field changes', () => {
		const { itemId, cycleId } = seedNewRun();
		applyRun(db, {
			runId: 'run-1',
			itemId,
			cycleId,
			updates: [],
			acceptedFieldKeys: [],
			reviewedAt: new Date().toISOString()
		});
		expect(getById(db, 'run-1')!.status).toBe('APPLIED');
		const field = db
			.prepare('SELECT value FROM cycle_fields WHERE cycle_id = ? AND field_key = ?')
			.get(cycleId, 'contract_end') as { value: string | null };
		expect(field.value).toBeNull();
	});
});

describe('dismissRun', () => {
	it('is atomic NEW -> DISMISSED and changes no cycle_fields row', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		db.prepare(
			`INSERT INTO extraction_runs (id, item_id, cycle_id, attachment_id, provider_id, model_id, status, created_at, reviewed_at)
			 VALUES ('run-1', ?, ?, ?, 'fake', 'fake-v1', 'NEW', ?, NULL)`
		).run(itemId, cycleId, attachmentId, new Date().toISOString());

		dismissRun(db, { runId: 'run-1', itemId, cycleId, reviewedAt: new Date().toISOString() });

		const run = getById(db, 'run-1')!;
		expect(run.status).toBe('DISMISSED');
		expect(run.reviewedAt).not.toBeNull();
	});

	it('a double submit throws and cannot dismiss twice', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		db.prepare(
			`INSERT INTO extraction_runs (id, item_id, cycle_id, attachment_id, provider_id, model_id, status, created_at, reviewed_at)
			 VALUES ('run-1', ?, ?, ?, 'fake', 'fake-v1', 'NEW', ?, NULL)`
		).run(itemId, cycleId, attachmentId, new Date().toISOString());
		dismissRun(db, { runId: 'run-1', itemId, cycleId, reviewedAt: new Date().toISOString() });
		expect(() =>
			dismissRun(db, { runId: 'run-1', itemId, cycleId, reviewedAt: new Date().toISOString() })
		).toThrow(ExtractionRunNotReviewableError);
	});
});

describe('AI Extraction 1.1: additional suggestions', () => {
	function insertNewRunWithAdditionalSuggestions(
		itemId: string,
		cycleId: string,
		attachmentId: string
	) {
		db.prepare(
			`INSERT INTO extraction_runs (id, item_id, cycle_id, attachment_id, provider_id, model_id, status, created_at, reviewed_at)
			 VALUES ('run-1', ?, ?, ?, 'fake', 'fake-v1', 'NEW', ?, NULL)`
		).run(itemId, cycleId, attachmentId, new Date().toISOString());
		db.prepare(
			`INSERT INTO extraction_additional_suggestions (id, run_id, suggested_label, suggested_type, value, position, accepted)
			 VALUES ('sug-1', 'run-1', 'Fahrzeugmodell', 'text', 'CUPRA Born', 0, 0),
			        ('sug-2', 'run-1', 'Monatliche Rate', 'currency', '351.00 EUR', 1, 0)`
		).run();
	}

	it('additional suggestions survive being listed across a reload (before any review)', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		insertNewRunWithAdditionalSuggestions(itemId, cycleId, attachmentId);

		const suggestions = listAdditionalSuggestions(db, 'run-1');
		expect(suggestions).toEqual([
			{
				id: 'sug-1',
				suggestedLabel: 'Fahrzeugmodell',
				suggestedType: 'text',
				value: 'CUPRA Born',
				position: 0,
				accepted: false
			},
			{
				id: 'sug-2',
				suggestedLabel: 'Monatliche Rate',
				suggestedType: 'currency',
				value: '351.00 EUR',
				position: 1,
				accepted: false
			}
		]);
	});

	it('creates one CUSTOM field per selection, sets its value, and marks the suggestion accepted', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		insertNewRunWithAdditionalSuggestions(itemId, cycleId, attachmentId);

		addAdditionalFields(db, {
			runId: 'run-1',
			itemId,
			cycleId,
			selections: [
				{ suggestionId: 'sug-1', label: 'Fahrzeugmodell', type: 'text', value: 'CUPRA Born' }
			]
		});

		const field = db
			.prepare('SELECT * FROM cycle_fields WHERE cycle_id = ? AND label = ?')
			.get(cycleId, 'Fahrzeugmodell') as
			{ origin: string; type: string; value: string } | undefined;
		expect(field).toMatchObject({ origin: 'CUSTOM', type: 'text', value: 'CUPRA Born' });

		expect(listAdditionalSuggestions(db, 'run-1').find((s) => s.id === 'sug-1')?.accepted).toBe(
			true
		);
	});

	it('adding several selections in one call is atomic: all succeed together', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		insertNewRunWithAdditionalSuggestions(itemId, cycleId, attachmentId);

		addAdditionalFields(db, {
			runId: 'run-1',
			itemId,
			cycleId,
			selections: [
				{ suggestionId: 'sug-1', label: 'Fahrzeugmodell', type: 'text', value: 'CUPRA Born' },
				{ suggestionId: 'sug-2', label: 'Monatliche Rate', type: 'currency', value: '351.00 EUR' }
			]
		});

		const count = db
			.prepare('SELECT COUNT(*) n FROM cycle_fields WHERE cycle_id = ?')
			.get(cycleId) as {
			n: number;
		};
		// 1 pre-existing (`contract_end`, from fixture()) + 2 new ones.
		expect(count.n).toBe(3);
	});

	it('a suggestion id that does not belong to this run creates nothing (atomic rollback)', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		insertNewRunWithAdditionalSuggestions(itemId, cycleId, attachmentId);

		expect(() =>
			addAdditionalFields(db, {
				runId: 'run-1',
				itemId,
				cycleId,
				selections: [
					{ suggestionId: 'sug-1', label: 'Fahrzeugmodell', type: 'text', value: 'CUPRA Born' },
					{ suggestionId: 'not-a-real-id', label: 'Ghost', type: 'text', value: 'x' }
				]
			})
		).toThrow(AdditionalSuggestionNotFoundError);

		const count = db
			.prepare('SELECT COUNT(*) n FROM cycle_fields WHERE cycle_id = ?')
			.get(cycleId) as {
			n: number;
		};
		expect(count.n).toBe(1); // only the pre-existing `contract_end` field
		expect(listAdditionalSuggestions(db, 'run-1').every((s) => !s.accepted)).toBe(true);
	});

	it('refuses to add fields once the run is no longer NEW (already applied/dismissed)', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		insertNewRunWithAdditionalSuggestions(itemId, cycleId, attachmentId);
		dismissRun(db, { runId: 'run-1', itemId, cycleId, reviewedAt: new Date().toISOString() });

		expect(() =>
			addAdditionalFields(db, {
				runId: 'run-1',
				itemId,
				cycleId,
				selections: [{ suggestionId: 'sug-1', label: 'Fahrzeugmodell', type: 'text', value: 'x' }]
			})
		).toThrow(ExtractionRunNotReviewableError);
	});

	it('refuses to add fields once the item has been archived', () => {
		const { itemId, cycleId, attachmentId } = fixture();
		insertNewRunWithAdditionalSuggestions(itemId, cycleId, attachmentId);
		db.prepare(`UPDATE items SET status = 'ARCHIVED' WHERE id = ?`).run(itemId);

		expect(() =>
			addAdditionalFields(db, {
				runId: 'run-1',
				itemId,
				cycleId,
				selections: [{ suggestionId: 'sug-1', label: 'Fahrzeugmodell', type: 'text', value: 'x' }]
			})
		).toThrow(ItemNotWritableError);
	});
});
