import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Field, FieldOrigin, FieldType } from '$lib/domain/field/field';
import { assertCycleIsWritable } from './writeGuards';

interface FieldRow {
	id: string;
	cycle_id: string;
	field_key: string;
	label: string;
	type: string;
	origin: string;
	recommended: number;
	position: number;
	value: string | null;
}

function mapField(row: FieldRow): Field {
	return {
		id: row.id,
		cycleId: row.cycle_id,
		fieldKey: row.field_key,
		label: row.label,
		type: row.type as FieldType,
		origin: row.origin as FieldOrigin,
		recommended: row.recommended === 1,
		position: row.position,
		value: row.value
	};
}

export function listFields(db: Database.Database, cycleId: string): Field[] {
	const rows = db
		.prepare('SELECT * FROM cycle_fields WHERE cycle_id = ? ORDER BY position')
		.all(cycleId) as FieldRow[];
	return rows.map(mapField);
}

/** Sets a single field's raw value. Callers are responsible for date-format validation before calling this. */
export function setFieldValue(
	db: Database.Database,
	cycleId: string,
	fieldKey: string,
	value: string | null
): void {
	db.prepare('UPDATE cycle_fields SET value = ? WHERE cycle_id = ? AND field_key = ?').run(
		value,
		cycleId,
		fieldKey
	);
}

function slugify(label: string): string {
	const slug = label
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return slug || 'field';
}

export interface AddCustomFieldInput {
	label: string;
	type: FieldType;
}

/**
 * Adds a user-defined field to a cycle. Custom fields render through the
 * exact same FieldInput component as playbook fields (only `origin`
 * differs) and can be removed again later — unlike a PLAYBOOK field,
 * which is permanent for the life of the item.
 *
 * Guarded by `assertCycleIsWritable` inside the same transaction as the
 * insert (Slice 8 review, finding 2).
 */
/**
 * The actual insert, factored out so a caller that already holds its own
 * transaction (and its own `assertCycleIsWritable` guard) — currently only
 * `extractionRepository.addAdditionalFields` — can create several CUSTOM
 * fields atomically without nesting a second guarded transaction inside
 * the first. `addCustomField` below is the guarded, standalone entry
 * point every other caller uses.
 */
export function insertCustomFieldRow(
	db: Database.Database,
	cycleId: string,
	input: AddCustomFieldInput
): Field {
	const existing = listFields(db, cycleId);
	const existingKeys = new Set(existing.map((f) => f.fieldKey));
	const maxPosition = existing.reduce((max, f) => Math.max(max, f.position), -1);

	const baseSlug = slugify(input.label);
	let fieldKey = `c_${baseSlug}`;
	let suffix = 2;
	while (existingKeys.has(fieldKey)) {
		fieldKey = `c_${baseSlug}_${suffix}`;
		suffix++;
	}

	const id = crypto.randomUUID();
	const label = input.label.trim();
	const position = maxPosition + 1;

	db.prepare(
		`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, recommended, position, value)
		 VALUES (?, ?, ?, ?, ?, 'CUSTOM', 0, ?, NULL)`
	).run(id, cycleId, fieldKey, label, input.type, position);

	return {
		id,
		cycleId,
		fieldKey,
		label,
		type: input.type,
		origin: 'CUSTOM',
		recommended: false,
		position,
		value: null
	};
}

export function addCustomField(
	db: Database.Database,
	cycleId: string,
	input: AddCustomFieldInput
): Field {
	return db.transaction((): Field => {
		assertCycleIsWritable(db, cycleId);
		return insertCustomFieldRow(db, cycleId, input);
	})();
}

export class CannotRemovePlaybookFieldError extends Error {
	constructor(fieldKey: string) {
		super(`Field "${fieldKey}" originates from a playbook and cannot be removed`);
		this.name = 'CannotRemovePlaybookFieldError';
	}
}

/** Removes a CUSTOM field. Throws if the field is PLAYBOOK-origin or does
 *  not exist. Guarded by `assertCycleIsWritable` inside the same
 *  transaction as the delete (Slice 8 review, finding 2). */
export function removeCustomField(db: Database.Database, cycleId: string, fieldKey: string): void {
	db.transaction(() => {
		assertCycleIsWritable(db, cycleId);

		const row = db
			.prepare('SELECT origin FROM cycle_fields WHERE cycle_id = ? AND field_key = ?')
			.get(cycleId, fieldKey) as { origin: string } | undefined;
		if (!row) return;
		if (row.origin !== 'CUSTOM') {
			throw new CannotRemovePlaybookFieldError(fieldKey);
		}
		db.prepare('DELETE FROM cycle_fields WHERE cycle_id = ? AND field_key = ?').run(
			cycleId,
			fieldKey
		);
	})();
}
