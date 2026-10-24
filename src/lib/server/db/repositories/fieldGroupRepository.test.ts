import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import { runMigrations } from '../migrate';
import { groupFields } from '$lib/domain/field/fieldGroup';
import { planNextCycleFields } from '$lib/domain/cycle/rollover';
import { materializePlaybook, type MaterializationPlan } from '$lib/domain/playbook/materialize';
import { normalizePlaybook } from '$lib/domain/playbook/normalize';
import { parsePlaybookStructure } from '$lib/domain/playbook/schema';
import type { StartNextCycleInput } from '$lib/application/ports';
import { createItem, setItemStatus } from './itemRepository';
import {
	addCustomField,
	insertCustomFieldRow,
	listFields,
	removeCustomField,
	setFieldValue
} from './fieldRepository';
import { getActiveCycle, startNextCycle } from './cycleRepository';
import { listActions } from './actionRepository';
import { listEvents } from './eventRepository';
import {
	FieldGroupTargetNotFoundError,
	createFieldGroup,
	listFieldGroupAssignments,
	listFieldGroups,
	moveFieldToGroup,
	renameFieldGroup,
	reorderFieldGroups,
	setFieldGroupFeatured
} from './fieldGroupRepository';
import { ItemNotWritableError } from './writeGuards';

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-field-group-repo-'));
	db = openDatabase(path.join(tmpDir, 'test.sqlite'));
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function playbook() {
	const parsed = parsePlaybookStructure({
		schemaVersion: 1,
		id: 'test.generic',
		version: '1.0.0',
		name: 'Generic',
		fields: [
			{ key: 'start', label: 'Start', type: 'date' },
			{ key: 'provider', label: 'Provider', type: 'text', carryForward: true },
			{ key: 'plate', label: 'Plate', type: 'text' }
		],
		events: [{ key: 'start_event', label: 'Start', sourceField: 'start' }],
		actions: [{ key: 'review', label: 'Review' }]
	});
	if (!parsed.success) throw new Error('fixture invalid');
	return normalizePlaybook(parsed.data);
}

function plannedGroups(): MaterializationPlan {
	const plan = materializePlaybook(playbook());
	return {
		...plan,
		groups: [
			{ groupKey: 'basics', label: 'Basics', labelI18n: {}, position: 0 },
			{ groupKey: 'vehicle', label: 'Vehicle', labelI18n: {}, position: 1 }
		],
		fields: plan.fields.map((f) => ({
			...f,
			groupKey:
				f.fieldKey === 'plate' ? 'vehicle' : f.fieldKey === 'provider' ? 'basics' : undefined
		}))
	};
}

function createGroupedItem() {
	const pb = playbook();
	return createItem(db, {
		title: 'Grouped',
		note: null,
		playbook: { id: pb.id, version: pb.version, name: pb.name, snapshot: pb },
		materialization: plannedGroups()
	});
}

function createGenericItem() {
	return createItem(db, {
		title: 'Generic',
		note: null,
		playbook: null,
		materialization: { fields: [], events: [], actions: [] }
	});
}

function groupViews(itemId: string) {
	const cycle = getActiveCycle(db, itemId)!;
	return groupFields(
		listFieldGroups(db, itemId),
		listFieldGroupAssignments(db, itemId),
		listFields(db, cycle.id)
	);
}

function labels(itemId: string): (string | null)[] {
	return groupViews(itemId).map((v) => v.group.label);
}

describe('initial groups', () => {
	it('gives every item exactly one default group and no assignments when the plan has no groups', () => {
		const item = createGenericItem();
		const groups = listFieldGroups(db, item.id);
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ label: null, isDefault: true, featured: false });
		expect(listFieldGroupAssignments(db, item.id)).toEqual([]);
	});

	it('keeps an ungrouped playbook item in General and lists every field there', () => {
		const pb = playbook();
		const item = createItem(db, {
			title: 'Ungrouped',
			note: null,
			playbook: { id: pb.id, version: pb.version, name: pb.name, snapshot: pb },
			materialization: materializePlaybook(pb)
		});
		const views = groupViews(item.id);
		expect(views).toHaveLength(1);
		expect(views[0].fields.map((f) => f.fieldKey)).toEqual(['start', 'provider', 'plate']);
	});

	it('seeds playbook groups, order and assignments at materialization, General last', () => {
		const item = createGroupedItem();
		const views = groupViews(item.id);
		expect(views.map((v) => v.group.label)).toEqual(['Basics', 'Vehicle', null]);
		expect(views.map((v) => v.fields.map((f) => f.fieldKey))).toEqual([
			['provider'],
			['plate'],
			['start']
		]);
	});

	it('puts custom fields into General and leaves their value and origin alone', () => {
		const item = createGroupedItem();
		const cycle = getActiveCycle(db, item.id)!;
		addCustomField(db, cycle.id, { label: 'Notes', type: 'text' });
		const general = groupViews(item.id).find((v) => v.group.isDefault)!;
		expect(general.fields.map((f) => f.fieldKey)).toContain('c_notes');
	});
});

describe('item-owned group management', () => {
	it('changes presentation without changing fields, events, actions or the frozen snapshot', () => {
		const item = createGroupedItem();
		const cycle = getActiveCycle(db, item.id)!;
		setFieldValue(db, cycle.id, 'start', '2030-06-01');
		setFieldValue(db, cycle.id, 'provider', 'Fictional provider');
		const domainState = () => ({
			cycle: getActiveCycle(db, item.id),
			fields: listFields(db, cycle.id),
			events: listEvents(db, cycle.id),
			actions: listActions(db, cycle.id),
			snapshot: createItemSnapshot(item.id)
		});
		const before = domainState();
		const group = createFieldGroup(db, item.id, 'Important');
		renameFieldGroup(db, item.id, group.id, 'My details');
		moveFieldToGroup(db, item.id, 'start', group.id);
		moveFieldToGroup(db, item.id, 'plate', group.id);
		setFieldGroupFeatured(db, item.id, group.id, true);
		reorderFieldGroups(
			db,
			item.id,
			listFieldGroups(db, item.id)
				.map((g) => g.id)
				.reverse()
		);
		setFieldGroupFeatured(db, item.id, group.id, false);

		expect(domainState()).toEqual(before);
		const view = groupViews(item.id).find((v) => v.group.id === group.id)!;
		expect(view.fields.map((f) => f.fieldKey)).toEqual(['start', 'plate']);
	});

	it('creates and renames groups without touching fields', () => {
		const item = createGroupedItem();
		const cycle = getActiveCycle(db, item.id)!;
		const before = listFields(db, cycle.id);
		const created = createFieldGroup(db, item.id, 'Insurance');
		renameFieldGroup(db, item.id, created.id, 'Cover');
		expect(labels(item.id)).toEqual(['Basics', 'Vehicle', null, 'Cover']);
		expect(listFields(db, cycle.id)).toEqual(before);
	});

	it('moves a field between groups, including empty ones, and keeps all fields', () => {
		const item = createGroupedItem();
		const cycle = getActiveCycle(db, item.id)!;
		const target = createFieldGroup(db, item.id, 'Other');
		moveFieldToGroup(db, item.id, 'plate', target.id);
		moveFieldToGroup(db, item.id, 'plate', target.id);
		const views = groupViews(item.id);
		expect(views.find((v) => v.group.id === target.id)!.fields.map((f) => f.fieldKey)).toEqual([
			'plate'
		]);
		expect(views.flatMap((v) => v.fields)).toHaveLength(listFields(db, cycle.id).length);
		expect(views.find((v) => v.group.label === 'Vehicle')!.fields).toEqual([]);
	});

	it('features and unfeatures groups and restores the previous order', () => {
		const item = createGroupedItem();
		const vehicle = listFieldGroups(db, item.id).find((g) => g.label === 'Vehicle')!;
		setFieldGroupFeatured(db, item.id, vehicle.id, true);
		expect(labels(item.id)).toEqual(['Vehicle', 'Basics', null]);
		setFieldGroupFeatured(db, item.id, vehicle.id, false);
		expect(labels(item.id)).toEqual(['Basics', 'Vehicle', null]);
	});

	it('keeps relative order inside the featured and non-featured partitions', () => {
		const item = createGroupedItem();
		const [basics, vehicle, general] = listFieldGroups(db, item.id);
		reorderFieldGroups(db, item.id, [general.id, vehicle.id, basics.id]);
		setFieldGroupFeatured(db, item.id, basics.id, true);
		setFieldGroupFeatured(db, item.id, general.id, true);
		expect(labels(item.id)).toEqual([null, 'Basics', 'Vehicle']);
	});

	it('rejects an incomplete or foreign reorder list', () => {
		const item = createGroupedItem();
		const other = createGroupedItem();
		const ids = listFieldGroups(db, item.id).map((g) => g.id);
		expect(() => reorderFieldGroups(db, item.id, ids.slice(1))).toThrow(
			FieldGroupTargetNotFoundError
		);
		expect(() =>
			reorderFieldGroups(db, item.id, [
				...ids.slice(1),
				...listFieldGroups(db, other.id)
					.map((g) => g.id)
					.slice(0, 1)
			])
		).toThrow(FieldGroupTargetNotFoundError);
	});

	it('rejects a group or field that does not belong to the item', () => {
		const item = createGroupedItem();
		const other = createGroupedItem();
		const foreignGroup = listFieldGroups(db, other.id)[0];
		const ownGroup = listFieldGroups(db, item.id)[0];
		expect(() => moveFieldToGroup(db, item.id, 'plate', foreignGroup.id)).toThrow(
			FieldGroupTargetNotFoundError
		);
		expect(() => moveFieldToGroup(db, item.id, 'missing', ownGroup.id)).toThrow(
			FieldGroupTargetNotFoundError
		);
		expect(() => setFieldGroupFeatured(db, item.id, foreignGroup.id, true)).toThrow(
			FieldGroupTargetNotFoundError
		);
		expect(() => renameFieldGroup(db, item.id, foreignGroup.id, 'x')).toThrow(
			FieldGroupTargetNotFoundError
		);
	});

	it('is read-only for archived items', () => {
		const item = createGroupedItem();
		const group = listFieldGroups(db, item.id)[0];
		setItemStatus(db, item.id, 'ARCHIVED');
		expect(() => createFieldGroup(db, item.id, 'New')).toThrow(ItemNotWritableError);
		expect(() => renameFieldGroup(db, item.id, group.id, 'New')).toThrow(ItemNotWritableError);
		expect(() => setFieldGroupFeatured(db, item.id, group.id, true)).toThrow(ItemNotWritableError);
		expect(() => moveFieldToGroup(db, item.id, 'plate', group.id)).toThrow(ItemNotWritableError);
		expect(() =>
			reorderFieldGroups(
				db,
				item.id,
				listFieldGroups(db, item.id).map((g) => g.id)
			)
		).toThrow(ItemNotWritableError);
	});

	it('drops the assignment of a removed custom field only', () => {
		const item = createGroupedItem();
		const cycle = getActiveCycle(db, item.id)!;
		const custom = addCustomField(db, cycle.id, { label: 'Notes', type: 'text' });
		const group = createFieldGroup(db, item.id, 'Extra');
		moveFieldToGroup(db, item.id, custom.fieldKey, group.id);
		removeCustomField(db, cycle.id, custom.fieldKey);
		const keys = listFieldGroupAssignments(db, item.id).map((a) => a.fieldKey);
		expect(keys).not.toContain(custom.fieldKey);
		expect(keys).toContain('plate');
	});
});

function rolloverInput(itemId: string): StartNextCycleInput {
	const item = createItemSnapshot(itemId);
	const plan = materializePlaybook(item);
	const cycle = getActiveCycle(db, itemId)!;
	return {
		itemId,
		completingCycleId: cycle.id,
		playbookVersion: item.version,
		fields: planNextCycleFields(plan, listFields(db, cycle.id)),
		events: plan.events,
		actions: plan.actions
	};
}

function createItemSnapshot(itemId: string) {
	const row = db.prepare('SELECT playbook_snapshot FROM items WHERE id = ?').get(itemId) as {
		playbook_snapshot: string;
	};
	return JSON.parse(row.playbook_snapshot) as ReturnType<typeof playbook>;
}

describe('cycle persistence', () => {
	it('keeps groups, assignments, order and featured state through a new cycle while values reset', () => {
		const item = createGroupedItem();
		const cycle = getActiveCycle(db, item.id)!;
		const custom = addCustomField(db, cycle.id, { label: 'Notes', type: 'text' });
		setFieldValue(db, cycle.id, 'start', '2026-06-01');
		setFieldValue(db, cycle.id, 'provider', 'Acme');
		const extra = createFieldGroup(db, item.id, 'Extra');
		moveFieldToGroup(db, item.id, custom.fieldKey, extra.id);
		moveFieldToGroup(db, item.id, 'provider', extra.id);
		renameFieldGroup(db, item.id, extra.id, 'Saved details');
		reorderFieldGroups(
			db,
			item.id,
			listFieldGroups(db, item.id)
				.map((g) => g.id)
				.reverse()
		);
		setFieldGroupFeatured(db, item.id, extra.id, true);
		const before = {
			groups: listFieldGroups(db, item.id),
			assignments: listFieldGroupAssignments(db, item.id)
		};
		const historicalFields = listFields(db, cycle.id);
		db.prepare("UPDATE actions SET state = 'DONE', completed_at = 'x' WHERE cycle_id = ?").run(
			cycle.id
		);

		startNextCycle(db, rolloverInput(item.id));

		expect(listFieldGroups(db, item.id)).toEqual(before.groups);
		expect(listFieldGroupAssignments(db, item.id)).toEqual(before.assignments);
		const views = groupViews(item.id);
		expect(views[0].group.label).toBe('Saved details');
		expect(views[0].fields.map((f) => f.fieldKey).sort()).toEqual(['c_notes', 'provider']);
		const fields = listFields(db, getActiveCycle(db, item.id)!.id);
		expect(fields.find((f) => f.fieldKey === 'start')!.value).toBeNull();
		expect(fields.find((f) => f.fieldKey === 'provider')!.value).toBe('Acme');
		expect(listFields(db, cycle.id)).toEqual(historicalFields);
	});
});

describe('field key reuse', () => {
	it('gives a recreated same-label field a fresh key that defaults to General after rollover and removal', () => {
		const item = createGroupedItem();
		const first = getActiveCycle(db, item.id)!;
		const custom = addCustomField(db, first.id, { label: 'Notes', type: 'text' });
		const extra = createFieldGroup(db, item.id, 'Extra');
		moveFieldToGroup(db, item.id, custom.fieldKey, extra.id);
		setFieldGroupFeatured(db, item.id, extra.id, true);
		db.prepare("UPDATE actions SET state = 'DONE', completed_at = 'x' WHERE cycle_id = ?").run(
			first.id
		);
		startNextCycle(db, rolloverInput(item.id));
		const second = getActiveCycle(db, item.id)!;
		removeCustomField(db, second.id, custom.fieldKey);

		// Same insertion function the document-suggestion path uses.
		const recreated = insertCustomFieldRow(db, second.id, { label: 'Notes', type: 'text' });

		expect(recreated.fieldKey).not.toBe(custom.fieldKey);
		const view = groupViews(item.id).find((v) =>
			v.fields.some((f) => f.fieldKey === recreated.fieldKey)
		)!;
		expect(view.group.isDefault).toBe(true);
		expect(view.group.featured).toBe(false);
	});
});

describe('migration 0019', () => {
	it('adds only a default group to existing items and moves no field', () => {
		const item = createGroupedItem();
		const cycle = getActiveCycle(db, item.id)!;
		const fieldsBefore = listFields(db, cycle.id);
		db.prepare('DROP TABLE item_field_group_assignments').run();
		db.prepare('DROP TABLE item_field_groups').run();
		db.prepare('DELETE FROM schema_migrations WHERE version = ?').run('0019_item_field_groups');

		const result = runMigrations(db);

		expect(result.applied).toEqual(['0019_item_field_groups']);
		const groups = listFieldGroups(db, item.id);
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ label: null, isDefault: true, featured: false });
		expect(listFieldGroupAssignments(db, item.id)).toEqual([]);
		expect(listFields(db, cycle.id)).toEqual(fieldsBefore);
		const views = groupViews(item.id);
		expect(views).toHaveLength(1);
		expect(views[0].fields).toHaveLength(fieldsBefore.length);
	});

	it('leaves the frozen snapshot of an existing item untouched', () => {
		const item = createGroupedItem();
		const snapshotBefore = db
			.prepare('SELECT playbook_snapshot FROM items WHERE id = ?')
			.get(item.id);
		db.prepare('DROP TABLE item_field_group_assignments').run();
		db.prepare('DROP TABLE item_field_groups').run();
		db.prepare('DELETE FROM schema_migrations WHERE version = ?').run('0019_item_field_groups');
		runMigrations(db);
		expect(db.prepare('SELECT playbook_snapshot FROM items WHERE id = ?').get(item.id)).toEqual(
			snapshotBefore
		);
	});
});
