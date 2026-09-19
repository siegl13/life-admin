import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import { buildWhatsNext } from '$lib/domain/whatsnext/whatsNext';
import { materializePlaybook } from '$lib/domain/playbook/materialize';
import { normalizePlaybook } from '$lib/domain/playbook/normalize';
import { parsePlaybookStructure } from '$lib/domain/playbook/schema';
import { setActionState } from './actionRepository';
import { createItem, setItemStatus } from './itemRepository';
import { startNextCycle } from './cycleRepository';
import { planNextCycleFields } from '$lib/domain/cycle/rollover';
import { listFields } from './fieldRepository';
import { applyFieldUpdatesAndRecalculate } from './scheduleRepository';
import { loadWhatsNextItems } from './whatsNextRepository';

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-whatsnext-'));
	db = openDatabase(path.join(tmpDir, 'test.sqlite'));
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function tuvPlaybook() {
	const parsed = parsePlaybookStructure({
		schemaVersion: 1,
		id: 'de.vehicle.tuv',
		version: '1.0.0',
		name: 'TÜV',
		fields: [{ key: 'next_inspection', type: 'date', label: 'Next inspection', recommended: true }],
		events: [{ key: 'inspection_due', label: 'Inspection due', sourceField: 'next_inspection' }],
		actions: [
			{
				key: 'book_appointment',
				label: 'Book appointment',
				due: { event: 'inspection_due', offset: { months: -1 } }
			},
			{
				key: 'attend_inspection',
				label: 'Attend inspection',
				due: { event: 'inspection_due' },
				dependsOn: ['book_appointment']
			}
		]
	});
	if (!parsed.success) throw new Error('fixture invalid');
	return normalizePlaybook(parsed.data);
}

function cycleIdOf(itemId: string): string {
	return (
		db.prepare(`SELECT id FROM cycles WHERE item_id = ? AND status = 'ACTIVE'`).get(itemId) as {
			id: string;
		}
	).id;
}

describe('loadWhatsNextItems + buildWhatsNext (integration)', () => {
	it('excludes an item entirely before its date field is filled in (unresolved derived action)', () => {
		const playbook = tuvPlaybook();
		createItem(db, {
			title: 'Mein Auto',
			note: null,
			playbook: {
				id: playbook.id,
				version: playbook.version,
				name: playbook.name,
				snapshot: playbook
			},
			materialization: materializePlaybook(playbook)
		});

		const groups = buildWhatsNext(loadWhatsNextItems(db), '2026-09-06');
		expect(groups).toEqual([]);
	});

	it('shows only the first available action of a dependency chain', () => {
		const playbook = tuvPlaybook();
		const item = createItem(db, {
			title: 'Mein Auto',
			note: null,
			playbook: {
				id: playbook.id,
				version: playbook.version,
				name: playbook.name,
				snapshot: playbook
			},
			materialization: materializePlaybook(playbook)
		});
		applyFieldUpdatesAndRecalculate(db, cycleIdOf(item.id), [
			{ fieldKey: 'next_inspection', value: '2020-01-01' } // in the past -> overdue
		]);

		const groups = buildWhatsNext(loadWhatsNextItems(db), '2026-09-06');
		expect(groups).toHaveLength(1);
		expect(groups[0].title).toBe('Mein Auto');
		expect(groups[0].actions.map((a) => a.label)).toEqual(['Book appointment']);
		expect(groups[0].actions[0].bucket).toBe(0); // overdue
	});

	it('activates the next action once the first is completed, and removes it from the working set', () => {
		const playbook = tuvPlaybook();
		const item = createItem(db, {
			title: 'Mein Auto',
			note: null,
			playbook: {
				id: playbook.id,
				version: playbook.version,
				name: playbook.name,
				snapshot: playbook
			},
			materialization: materializePlaybook(playbook)
		});
		const cycleId = cycleIdOf(item.id);
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'next_inspection', value: '2020-01-01' }
		]);

		const bookAppointment = db
			.prepare(`SELECT id FROM actions WHERE cycle_id = ? AND action_key = 'book_appointment'`)
			.get(cycleId) as { id: string };
		setActionState(db, item.id, bookAppointment.id, 'DONE');

		const groups = buildWhatsNext(loadWhatsNextItems(db), '2026-09-06');
		expect(groups).toHaveLength(1);
		expect(groups[0].actions.map((a) => a.label)).toEqual(['Attend inspection']);
	});

	it('omits an item entirely once every action is DONE/SKIPPED', () => {
		const playbook = tuvPlaybook();
		const item = createItem(db, {
			title: 'Mein Auto',
			note: null,
			playbook: {
				id: playbook.id,
				version: playbook.version,
				name: playbook.name,
				snapshot: playbook
			},
			materialization: materializePlaybook(playbook)
		});
		const cycleId = cycleIdOf(item.id);
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'next_inspection', value: '2020-01-01' }
		]);

		for (const key of ['book_appointment', 'attend_inspection']) {
			const row = db
				.prepare(`SELECT id FROM actions WHERE cycle_id = ? AND action_key = ?`)
				.get(cycleId, key) as { id: string };
			setActionState(db, item.id, row.id, 'DONE');
		}

		const groups = buildWhatsNext(loadWhatsNextItems(db), '2026-09-06');
		expect(groups).toEqual([]);
	});

	it('every rendered action always carries its item title (no orphan tasks)', () => {
		const playbook = tuvPlaybook();
		const item = createItem(db, {
			title: 'Mein Auto',
			note: null,
			playbook: {
				id: playbook.id,
				version: playbook.version,
				name: playbook.name,
				snapshot: playbook
			},
			materialization: materializePlaybook(playbook)
		});
		applyFieldUpdatesAndRecalculate(db, cycleIdOf(item.id), [
			{ fieldKey: 'next_inspection', value: '2020-01-01' }
		]);

		const items = loadWhatsNextItems(db);
		for (const i of items) {
			expect(i.title).toBeTruthy();
			for (const a of i.actions) {
				expect(a.label).toBeTruthy();
			}
		}
	});

	it("an archived item's open action never appears in What's Next (Slice 8)", () => {
		const playbook = tuvPlaybook();
		const item = createItem(db, {
			title: 'Mein Auto',
			note: null,
			playbook: {
				id: playbook.id,
				version: playbook.version,
				name: playbook.name,
				snapshot: playbook
			},
			materialization: materializePlaybook(playbook)
		});
		applyFieldUpdatesAndRecalculate(db, cycleIdOf(item.id), [
			{ fieldKey: 'next_inspection', value: '2020-01-01' }
		]);
		expect(buildWhatsNext(loadWhatsNextItems(db), '2026-09-06')).toHaveLength(1);

		setItemStatus(db, item.id, 'ARCHIVED');

		expect(buildWhatsNext(loadWhatsNextItems(db), '2026-09-06')).toEqual([]);
	});

	it('after a rollover, only the new ACTIVE cycles actions appear (Slice 8)', () => {
		const playbook = tuvPlaybook();
		const item = createItem(db, {
			title: 'Mein Auto',
			note: null,
			playbook: {
				id: playbook.id,
				version: playbook.version,
				name: playbook.name,
				snapshot: playbook
			},
			materialization: materializePlaybook(playbook)
		});
		const cycle1Id = cycleIdOf(item.id);
		applyFieldUpdatesAndRecalculate(db, cycle1Id, [
			{ fieldKey: 'next_inspection', value: '2020-01-01' }
		]);
		for (const key of ['book_appointment', 'attend_inspection']) {
			const row = db
				.prepare(`SELECT id FROM actions WHERE cycle_id = ? AND action_key = ?`)
				.get(cycle1Id, key) as { id: string };
			setActionState(db, item.id, row.id, 'DONE');
		}

		const plan = materializePlaybook(playbook);
		startNextCycle(db, {
			itemId: item.id,
			completingCycleId: cycle1Id,
			playbookVersion: playbook.version,
			fields: planNextCycleFields(plan, listFields(db, cycle1Id)),
			events: plan.events,
			actions: plan.actions
		});

		// The new cycle's actions are OPEN again but have no date carried
		// (a date field resets by default), so they are correctly excluded
		// as unresolved — proving loadWhatsNextItems reads the NEW active
		// cycle, not the completed one (which would show 0 actions either
		// way, but for the wrong reason).
		expect(buildWhatsNext(loadWhatsNextItems(db), '2026-09-06')).toEqual([]);
		const cycle2Id = cycleIdOf(item.id);
		expect(cycle2Id).not.toBe(cycle1Id);
		const newActions = db.prepare(`SELECT state FROM actions WHERE cycle_id = ?`).all(cycle2Id) as {
			state: string;
		}[];
		expect(newActions.every((a) => a.state === 'OPEN')).toBe(true);
	});
});
