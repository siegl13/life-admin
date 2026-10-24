import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FieldGroup, FieldGroupAssignment } from '$lib/domain/field/fieldGroup';
import type { MaterializationPlan } from '$lib/domain/playbook/materialize';
import { assertItemIsWritable } from './writeGuards';

interface GroupRow {
	id: string;
	item_id: string;
	label: string | null;
	is_default: number;
	featured: number;
	position: number;
}

function mapGroup(row: GroupRow): FieldGroup {
	return {
		id: row.id,
		itemId: row.item_id,
		label: row.label,
		isDefault: row.is_default === 1,
		featured: row.featured === 1,
		position: row.position
	};
}

/** Thrown when a group or field named by a mutation does not belong to the item. */
export class FieldGroupTargetNotFoundError extends Error {
	constructor() {
		super('Field group target not found');
		this.name = 'FieldGroupTargetNotFoundError';
	}
}

export function listFieldGroups(db: Database.Database, itemId: string): FieldGroup[] {
	return (
		db
			.prepare('SELECT * FROM item_field_groups WHERE item_id = ? ORDER BY position, rowid')
			.all(itemId) as GroupRow[]
	).map(mapGroup);
}

export function listFieldGroupAssignments(
	db: Database.Database,
	itemId: string
): FieldGroupAssignment[] {
	return (
		db
			.prepare('SELECT field_key, group_id FROM item_field_group_assignments WHERE item_id = ?')
			.all(itemId) as { field_key: string; group_id: string }[]
	).map((row) => ({ fieldKey: row.field_key, groupId: row.group_id }));
}

/**
 * Seeds an item's groups at creation. Always creates the default group (last,
 * after any playbook groups) and records the playbook's initial field
 * assignments. Called only from item creation: existing items are never
 * re-seeded from a playbook.
 */
export function insertInitialFieldGroups(
	db: Database.Database,
	itemId: string,
	plan: MaterializationPlan
): void {
	const insertGroup = db.prepare(
		`INSERT INTO item_field_groups (id, item_id, label, is_default, featured, position)
		 VALUES (?, ?, ?, ?, 0, ?)`
	);
	const planned = [...(plan.groups ?? [])].sort((a, b) => a.position - b.position);
	const idByGroupKey = new Map<string, string>();
	planned.forEach((group, index) => {
		const id = crypto.randomUUID();
		idByGroupKey.set(group.groupKey, id);
		insertGroup.run(id, itemId, group.label.trim(), 0, index);
	});
	insertGroup.run(crypto.randomUUID(), itemId, null, 1, planned.length);

	const insertAssignment = db.prepare(
		'INSERT INTO item_field_group_assignments (item_id, field_key, group_id) VALUES (?, ?, ?)'
	);
	for (const field of plan.fields) {
		const groupId = field.groupKey ? idByGroupKey.get(field.groupKey) : undefined;
		if (groupId) insertAssignment.run(itemId, field.fieldKey, groupId);
	}
}

function requireGroup(db: Database.Database, itemId: string, groupId: string): GroupRow {
	const row = db
		.prepare('SELECT * FROM item_field_groups WHERE id = ? AND item_id = ?')
		.get(groupId, itemId) as GroupRow | undefined;
	if (!row) throw new FieldGroupTargetNotFoundError();
	return row;
}

export function createFieldGroup(db: Database.Database, itemId: string, label: string): FieldGroup {
	return db.transaction((): FieldGroup => {
		assertItemIsWritable(db, itemId);
		const { next } = db
			.prepare(
				'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM item_field_groups WHERE item_id = ?'
			)
			.get(itemId) as { next: number };
		const id = crypto.randomUUID();
		db.prepare(
			`INSERT INTO item_field_groups (id, item_id, label, is_default, featured, position)
			 VALUES (?, ?, ?, 0, 0, ?)`
		).run(id, itemId, label, next);
		return mapGroup(requireGroup(db, itemId, id));
	})();
}

export function renameFieldGroup(
	db: Database.Database,
	itemId: string,
	groupId: string,
	label: string
): FieldGroup {
	return db.transaction((): FieldGroup => {
		assertItemIsWritable(db, itemId);
		requireGroup(db, itemId, groupId);
		db.prepare('UPDATE item_field_groups SET label = ? WHERE id = ?').run(label, groupId);
		return mapGroup(requireGroup(db, itemId, groupId));
	})();
}

export function setFieldGroupFeatured(
	db: Database.Database,
	itemId: string,
	groupId: string,
	featured: boolean
): FieldGroup {
	return db.transaction((): FieldGroup => {
		assertItemIsWritable(db, itemId);
		requireGroup(db, itemId, groupId);
		db.prepare('UPDATE item_field_groups SET featured = ? WHERE id = ?').run(
			featured ? 1 : 0,
			groupId
		);
		return mapGroup(requireGroup(db, itemId, groupId));
	})();
}

/** Rewrites group positions. `orderedGroupIds` must name every group of the item exactly once. */
export function reorderFieldGroups(
	db: Database.Database,
	itemId: string,
	orderedGroupIds: readonly string[]
): void {
	db.transaction(() => {
		assertItemIsWritable(db, itemId);
		const existing = new Set(listFieldGroups(db, itemId).map((g) => g.id));
		const unique = new Set(orderedGroupIds);
		const isCompleteOrder =
			unique.size === orderedGroupIds.length &&
			unique.size === existing.size &&
			orderedGroupIds.every((id) => existing.has(id));
		if (!isCompleteOrder) throw new FieldGroupTargetNotFoundError();
		const update = db.prepare('UPDATE item_field_groups SET position = ? WHERE id = ?');
		orderedGroupIds.forEach((id, index) => update.run(index, id));
	})();
}

/**
 * Moves one field of the item's active cycle into a group. The assignment is
 * keyed by field_key at item level, so it also applies to that field in every
 * later cycle. Never changes the field row or its value.
 */
export function moveFieldToGroup(
	db: Database.Database,
	itemId: string,
	fieldKey: string,
	groupId: string
): void {
	db.transaction(() => {
		assertItemIsWritable(db, itemId);
		requireGroup(db, itemId, groupId);
		const field = db
			.prepare(
				`SELECT 1 FROM cycle_fields f JOIN cycles c ON c.id = f.cycle_id
				 WHERE c.item_id = ? AND c.status = 'ACTIVE' AND f.field_key = ?`
			)
			.get(itemId, fieldKey);
		if (!field) throw new FieldGroupTargetNotFoundError();
		db.prepare(
			`INSERT INTO item_field_group_assignments (item_id, field_key, group_id) VALUES (?, ?, ?)
			 ON CONFLICT (item_id, field_key) DO UPDATE SET group_id = excluded.group_id`
		).run(itemId, fieldKey, groupId);
	})();
}
