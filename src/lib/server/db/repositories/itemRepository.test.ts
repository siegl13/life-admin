import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import { emptyMaterializationPlan, materializePlaybook } from '$lib/domain/playbook/materialize';
import { normalizePlaybook } from '$lib/domain/playbook/normalize';
import { parsePlaybookStructure } from '$lib/domain/playbook/schema';
import { createItem, getItemById, listItems, setItemStatus } from './itemRepository';
import { listFields } from './fieldRepository';
import { listEvents } from './eventRepository';
import { listActions, listDependencies } from './actionRepository';

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-item-repo-'));
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

describe('createItem', () => {
	it('creates a title-only generic item with no playbook', () => {
		const item = createItem(db, {
			title: 'Mallorca Trip',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});

		expect(item.title).toBe('Mallorca Trip');
		expect(item.playbookId).toBeNull();
		expect(item.playbookSnapshot).toBeNull();
		expect(listFields(db, mustGetActiveCycleId(item.id)).length).toBe(0);
	});

	it('trims the title', () => {
		const item = createItem(db, {
			title: '   Mallorca Trip   ',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});
		expect(item.title).toBe('Mallorca Trip');
	});

	it('fully materializes fields, events, actions and dependencies from a playbook', () => {
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

		const cycleId = mustGetActiveCycleId(item.id);
		const fields = listFields(db, cycleId);
		const events = listEvents(db, cycleId);
		const actions = listActions(db, cycleId);
		const deps = listDependencies(db, cycleId);

		expect(fields).toHaveLength(1);
		expect(fields[0]).toMatchObject({ fieldKey: 'valid_until', origin: 'PLAYBOOK', value: null });

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ eventKey: 'expiry', resolvedDate: null });

		expect(actions).toHaveLength(2);
		const requestNew = actions.find((a) => a.actionKey === 'request_new')!;
		expect(requestNew.dueKind).toBe('DERIVED');
		expect(requestNew.dueDate).toBeNull(); // unresolved: no date entered yet
		expect(requestNew.state).toBe('OPEN');

		const checkReceipt = actions.find((a) => a.actionKey === 'check_receipt')!;
		expect(checkReceipt.dueKind).toBe('NONE');

		expect(deps).toHaveLength(1);
		expect(deps[0].actionId).toBe(checkReceipt.id);
		expect(deps[0].dependsOnActionId).toBe(requestNew.id);
	});

	it('stores playbook provenance and a frozen snapshot', () => {
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

		expect(item.playbookId).toBe('de.finance.nv-certificate');
		expect(item.playbookVersion).toBe('1.0.0');
		expect(item.playbookName).toBe('NV certificate');
		expect(item.playbookSnapshot).toEqual(playbook);
	});

	it('sets cycle 1s playbook_version from the item playbook (Slice 8 regression)', () => {
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
		const row = db
			.prepare(`SELECT playbook_version FROM cycles WHERE item_id = ? AND status = 'ACTIVE'`)
			.get(item.id) as { playbook_version: string | null };
		expect(row.playbook_version).toBe('1.0.0');
	});

	it('rolls back the whole transaction if any insert fails (no partial item)', () => {
		const playbook = nvPlaybook();
		const plan = materializePlaybook(playbook);
		// Corrupt the plan so an action references a non-existent field key
		// is fine (that's allowed structurally), but force a genuine DB
		// failure: duplicate action_key within the same cycle.
		const brokenPlan = {
			...plan,
			actions: [...plan.actions, { ...plan.actions[0] }] // duplicate action_key -> UNIQUE violation
		};

		expect(() =>
			createItem(db, {
				title: 'Broken item',
				note: null,
				playbook: {
					id: playbook.id,
					version: playbook.version,
					name: playbook.name,
					snapshot: playbook
				},
				materialization: brokenPlan
			})
		).toThrow();

		expect(listItems(db)).toEqual([]);
		expect(db.prepare('SELECT COUNT(*) AS n FROM cycles').get()).toEqual({ n: 0 });
		expect(db.prepare('SELECT COUNT(*) AS n FROM actions').get()).toEqual({ n: 0 });
	});
});

describe('listItems / getItemById', () => {
	it('lists only ACTIVE items by default, newest first', () => {
		createItem(db, {
			title: 'A',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});
		createItem(db, {
			title: 'B',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});
		const items = listItems(db);
		expect(items.map((i) => i.title)).toEqual(['B', 'A']);
	});

	it('returns null for an unknown id', () => {
		expect(getItemById(db, 'does-not-exist')).toBeNull();
	});

	it('listItems() still defaults to ACTIVE (regression guard for the widened signature)', () => {
		createItem(db, {
			title: 'A',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});
		expect(listItems(db).every((i) => i.status === 'ACTIVE')).toBe(true);
	});

	it('lists ARCHIVED items only when asked, and excludes them from the ACTIVE default', () => {
		const active = createItem(db, {
			title: 'Active',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});
		const archived = createItem(db, {
			title: 'To be archived',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});
		setItemStatus(db, archived.id, 'ARCHIVED');

		expect(listItems(db, 'ACTIVE').map((i) => i.id)).toEqual([active.id]);
		expect(listItems(db, 'ARCHIVED').map((i) => i.id)).toEqual([archived.id]);
	});
});

describe('setItemStatus', () => {
	it('archiving sets archived_at and unarchiving clears it back to null', () => {
		const item = createItem(db, {
			title: 'A',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});

		const archived = setItemStatus(db, item.id, 'ARCHIVED');
		expect(archived.status).toBe('ARCHIVED');
		expect(archived.archivedAt).not.toBeNull();

		const reactivated = setItemStatus(db, item.id, 'ACTIVE');
		expect(reactivated.status).toBe('ACTIVE');
		expect(reactivated.archivedAt).toBeNull();
	});
});

describe('malformed playbook_snapshot (Slice 8 review, finding 3)', () => {
	it('getItemById never throws on corrupt snapshot JSON, and flags it distinctly from "no playbook"', () => {
		const item = createItem(db, {
			title: 'Tampered item',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});
		db.prepare(`UPDATE items SET playbook_snapshot = ? WHERE id = ?`).run(
			'{not-valid-json::::',
			item.id
		);

		const reloaded = getItemById(db, item.id)!;
		expect(reloaded.playbookSnapshot).toBeNull();
		expect(reloaded.playbookSnapshotCorrupted).toBe(true);
		expect(reloaded.title).toBe('Tampered item'); // basic data stays readable
	});

	it('listItems never throws on corrupt snapshot JSON (an item stays visible on /items)', () => {
		const item = createItem(db, {
			title: 'Tampered item',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});
		db.prepare(`UPDATE items SET playbook_snapshot = ? WHERE id = ?`).run('][', item.id);

		expect(() => listItems(db)).not.toThrow();
		const listed = listItems(db).find((i) => i.id === item.id)!;
		expect(listed.playbookSnapshotCorrupted).toBe(true);
	});

	it('a genuinely playbook-less item is not flagged as corrupted', () => {
		const item = createItem(db, {
			title: 'Generic item',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});
		const reloaded = getItemById(db, item.id)!;
		expect(reloaded.playbookSnapshot).toBeNull();
		expect(reloaded.playbookSnapshotCorrupted).toBe(false);
	});
});

function mustGetActiveCycleId(itemId: string): string {
	const row = db
		.prepare(`SELECT id FROM cycles WHERE item_id = ? AND status = 'ACTIVE'`)
		.get(itemId) as { id: string };
	return row.id;
}
