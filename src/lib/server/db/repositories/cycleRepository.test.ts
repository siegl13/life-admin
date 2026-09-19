import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import { materializePlaybook } from '$lib/domain/playbook/materialize';
import { normalizePlaybook } from '$lib/domain/playbook/normalize';
import { parsePlaybookStructure } from '$lib/domain/playbook/schema';
import { planNextCycleFields } from '$lib/domain/cycle/rollover';
import { createItem } from './itemRepository';
import { listFields } from './fieldRepository';
import { listActions, setActionDueOverride } from './actionRepository';
import {
	getActiveCycle,
	listCycles,
	startNextCycle,
	CycleNoLongerActiveError
} from './cycleRepository';
import type { StartNextCycleInput } from '$lib/application/ports';

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-cycle-repo-'));
	db = openDatabase(path.join(tmpDir, 'test.sqlite'));
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function nvPlaybook() {
	const parsed = parsePlaybookStructure({
		schemaVersion: 1,
		id: 'de.finance.nv-certificate',
		version: '1.0.0',
		name: 'NV certificate',
		fields: [{ key: 'valid_until', type: 'date', label: 'Valid until', carryForward: true }],
		events: [{ key: 'expiry', label: 'Expiry', sourceField: 'valid_until' }],
		actions: [
			{ key: 'request_new', label: 'Request new', due: { event: 'expiry', offset: { months: -2 } } }
		]
	});
	if (!parsed.success) throw new Error('fixture invalid');
	return normalizePlaybook(parsed.data);
}

/** Builds a real StartNextCycleInput for the given item's current active
 *  cycle, going through the real domain pipeline (materialize + rollover)
 *  rather than hand-typing plan objects. */
function buildRolloverInput(itemId: string): StartNextCycleInput {
	const playbook = nvPlaybook();
	const plan = materializePlaybook(playbook);
	const activeCycle = getActiveCycle(db, itemId)!;
	const previousFields = listFields(db, activeCycle.id);
	return {
		itemId,
		completingCycleId: activeCycle.id,
		playbookVersion: playbook.version,
		fields: planNextCycleFields(plan, previousFields),
		events: plan.events,
		actions: plan.actions
	};
}

function createNvItem() {
	const playbook = nvPlaybook();
	return createItem(db, {
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
}

function activeCycleCount(itemId: string): number {
	return (
		db
			.prepare(`SELECT COUNT(*) AS n FROM cycles WHERE item_id = ? AND status = 'ACTIVE'`)
			.get(itemId) as { n: number }
	).n;
}

describe('startNextCycle', () => {
	it('never leaves two ACTIVE cycles, and the old one becomes COMPLETED', () => {
		const item = createNvItem();
		startNextCycle(db, buildRolloverInput(item.id));

		expect(activeCycleCount(item.id)).toBe(1);
		const cycles = listCycles(db, item.id);
		expect(cycles).toHaveLength(2);
		expect(cycles.find((c) => c.sequence === 1)!.status).toBe('COMPLETED');
		expect(cycles.find((c) => c.sequence === 1)!.completedAt).not.toBeNull();
		expect(cycles.find((c) => c.sequence === 2)!.status).toBe('ACTIVE');
	});

	it('three consecutive rollovers yield sequences 1, 2, 3 with exactly one ACTIVE', () => {
		const item = createNvItem();
		startNextCycle(db, buildRolloverInput(item.id));
		startNextCycle(db, buildRolloverInput(item.id));

		const cycles = listCycles(db, item.id);
		expect(cycles.map((c) => c.sequence).sort()).toEqual([1, 2, 3]);
		expect(activeCycleCount(item.id)).toBe(1);
	});

	it('a second call against the already-completed cycle id throws and creates nothing new', () => {
		const item = createNvItem();
		const input = buildRolloverInput(item.id);
		startNextCycle(db, input);

		expect(() => startNextCycle(db, input)).toThrow(CycleNoLongerActiveError);
		expect(listCycles(db, item.id)).toHaveLength(2);
	});

	it('rolls back completely when a later insert fails (completed_at stays NULL)', () => {
		const item = createNvItem();
		const input = buildRolloverInput(item.id);
		const broken: StartNextCycleInput = {
			...input,
			actions: [...input.actions, { ...input.actions[0] }] // duplicate action_key -> UNIQUE violation
		};

		expect(() => startNextCycle(db, broken)).toThrow();

		const original = listCycles(db, item.id).find((c) => c.sequence === 1)!;
		expect(original.status).toBe('ACTIVE');
		expect(original.completedAt).toBeNull();
		expect(listCycles(db, item.id)).toHaveLength(1);
	});

	it('resolves a carried date value into a concrete due date immediately, with no extra save', () => {
		const item = createNvItem();
		// Enter the date on cycle 1 so it has something to carry.
		const cycle1 = getActiveCycle(db, item.id)!;
		db.prepare(
			`UPDATE cycle_fields SET value = ? WHERE cycle_id = ? AND field_key = 'valid_until'`
		).run('2026-06-01', cycle1.id);

		startNextCycle(db, buildRolloverInput(item.id));

		const cycle2 = getActiveCycle(db, item.id)!;
		const carriedField = listFields(db, cycle2.id).find((f) => f.fieldKey === 'valid_until')!;
		expect(carriedField.value).toBe('2026-06-01'); // carryForward: true on this field
		const action = listActions(db, cycle2.id).find((a) => a.actionKey === 'request_new')!;
		expect(action.dueDate).not.toBeNull();
	});

	it("does not carry a completed cycle's due-date override into the new cycle's action", () => {
		const item = createNvItem();
		const cycle1 = getActiveCycle(db, item.id)!;
		const oldAction = listActions(db, cycle1.id).find((a) => a.actionKey === 'request_new')!;
		setActionDueOverride(db, item.id, oldAction.id, '2026-12-24');

		startNextCycle(db, buildRolloverInput(item.id));

		const cycle2 = getActiveCycle(db, item.id)!;
		const newAction = listActions(db, cycle2.id).find((a) => a.actionKey === 'request_new')!;
		expect(newAction.id).not.toBe(oldAction.id);
		expect(newAction.dueOverrideDate).toBeNull();

		// The old cycle's own override is untouched — history stays exact.
		const historicAction = listActions(db, cycle1.id).find((a) => a.actionKey === 'request_new')!;
		expect(historicAction.dueOverrideDate).toBe('2026-12-24');
	});

	it('touches the item so its updated_at reflects the rollover', () => {
		const item = createNvItem();
		const before = db.prepare('SELECT updated_at FROM items WHERE id = ?').get(item.id) as {
			updated_at: string;
		};

		startNextCycle(db, {
			...buildRolloverInput(item.id),
			// Force a distinguishable timestamp regardless of clock resolution.
			playbookVersion: '1.0.0'
		});

		const after = db.prepare('SELECT updated_at FROM items WHERE id = ?').get(item.id) as {
			updated_at: string;
		};
		expect(Date.parse(after.updated_at)).toBeGreaterThanOrEqual(Date.parse(before.updated_at));
	});
});
