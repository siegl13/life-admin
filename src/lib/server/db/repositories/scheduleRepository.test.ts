import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import { materializePlaybook } from '$lib/domain/playbook/materialize';
import { normalizePlaybook } from '$lib/domain/playbook/normalize';
import { parsePlaybookStructure } from '$lib/domain/playbook/schema';
import { createItem, setItemStatus } from './itemRepository';
import { listFields } from './fieldRepository';
import { listEvents } from './eventRepository';
import { listActions, setActionDueOverride } from './actionRepository';
import { applyFieldUpdatesAndRecalculate } from './scheduleRepository';
import { ItemNotWritableError } from './writeGuards';

let tmpDir: string;
let db: Database.Database;
let itemId: string;
let cycleId: string;

function nvPlaybook() {
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
			},
			{ key: 'check_receipt', label: 'Check receipt', dependsOn: ['request_new'] }
		]
	});
	if (!parsed.success) throw new Error('fixture invalid');
	return normalizePlaybook(parsed.data);
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-schedule-repo-'));
	db = openDatabase(path.join(tmpDir, 'test.sqlite'));
	const playbook = nvPlaybook();
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
	itemId = item.id;
	cycleId = (
		db.prepare(`SELECT id FROM cycles WHERE item_id = ? AND status = 'ACTIVE'`).get(item.id) as {
			id: string;
		}
	).id;
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('applyFieldUpdatesAndRecalculate', () => {
	it('leaves a derived action unresolved before the date field is set', () => {
		const actions = listActions(db, cycleId);
		expect(actions.find((a) => a.actionKey === 'request_new')!.dueDate).toBeNull();
	});

	it('derives the action due date once the field is set', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'valid_until', value: '2028-08-31' }
		]);

		expect(listFields(db, cycleId)[0].value).toBe('2028-08-31');
		expect(listEvents(db, cycleId)[0].resolvedDate).toBe('2028-08-31');
		const requestNew = listActions(db, cycleId).find((a) => a.actionKey === 'request_new')!;
		expect(requestNew.dueDate).toBe('2028-06-30');
	});

	it('recalculates the due date again when the field value changes (critical: not a one-time computation)', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'valid_until', value: '2028-08-31' }
		]);
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'valid_until', value: '2029-01-31' }
		]);

		const requestNew = listActions(db, cycleId).find((a) => a.actionKey === 'request_new')!;
		expect(requestNew.dueDate).toBe('2028-11-30');
	});

	it('clears the derived date again when the field is cleared', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'valid_until', value: '2028-08-31' }
		]);
		applyFieldUpdatesAndRecalculate(db, cycleId, [{ fieldKey: 'valid_until', value: null }]);

		const requestNew = listActions(db, cycleId).find((a) => a.actionKey === 'request_new')!;
		expect(requestNew.dueDate).toBeNull();
	});

	it('never assigns a due date to a NONE-kind action', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'valid_until', value: '2028-08-31' }
		]);
		const checkReceipt = listActions(db, cycleId).find((a) => a.actionKey === 'check_receipt')!;
		expect(checkReceipt.dueDate).toBeNull();
		expect(checkReceipt.dueKind).toBe('NONE');
	});

	it('does not touch the state of an already-completed action', () => {
		const requestNew = listActions(db, cycleId).find((a) => a.actionKey === 'request_new')!;
		db.prepare(`UPDATE actions SET state = 'DONE', completed_at = ? WHERE id = ?`).run(
			new Date().toISOString(),
			requestNew.id
		);

		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'valid_until', value: '2028-08-31' }
		]);

		const updated = listActions(db, cycleId).find((a) => a.actionKey === 'request_new')!;
		expect(updated.state).toBe('DONE');
		expect(updated.dueDate).toBe('2028-06-30'); // date still recomputed
	});

	it('is atomic: a failure during recalculation rolls back the field write too', () => {
		// An invalid (non-ISO) date value makes deriveSchedule's internal
		// applyOffset() throw while computing the derived due date. This
		// happens inside the same transaction as the field write, so the
		// field write itself must not survive either.
		expect(() =>
			applyFieldUpdatesAndRecalculate(db, cycleId, [
				{ fieldKey: 'valid_until', value: 'not-a-date' }
			])
		).toThrow();

		expect(listFields(db, cycleId)[0].value).toBeNull();
		const requestNew = listActions(db, cycleId).find((a) => a.actionKey === 'request_new')!;
		expect(requestNew.dueDate).toBeNull();
	});

	it('recalculates the suggested due date but never overwrites a user override', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'valid_until', value: '2028-08-31' }
		]);
		const requestNew = listActions(db, cycleId).find((a) => a.actionKey === 'request_new')!;
		expect(requestNew.dueDate).toBe('2028-06-30');

		setActionDueOverride(db, itemId, requestNew.id, '2028-07-05');

		// The source field changes again — the playbook's own suggestion
		// moves, but the user's override must survive untouched.
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'valid_until', value: '2028-09-01' }
		]);
		const recalculated = listActions(db, cycleId).find((a) => a.actionKey === 'request_new')!;
		expect(recalculated.dueDate).toBe('2028-07-01'); // the new calculated suggestion
		expect(recalculated.dueOverrideDate).toBe('2028-07-05'); // unchanged

		// Resetting the override immediately uses the latest calculated date.
		setActionDueOverride(db, itemId, recalculated.id, null);
		const afterReset = listActions(db, cycleId).find((a) => a.actionKey === 'request_new')!;
		expect(afterReset.dueOverrideDate).toBeNull();
		expect(afterReset.dueDate).toBe('2028-07-01');
	});

	it('refuses to write field updates once the item is archived, and changes nothing (Slice 8 review, finding 2)', () => {
		setItemStatus(db, itemId, 'ARCHIVED');
		expect(() =>
			applyFieldUpdatesAndRecalculate(db, cycleId, [
				{ fieldKey: 'valid_until', value: '2028-08-31' }
			])
		).toThrow(ItemNotWritableError);
		expect(listFields(db, cycleId)[0].value).toBeNull();
	});
});
