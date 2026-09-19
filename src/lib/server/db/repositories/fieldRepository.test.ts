import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import { emptyMaterializationPlan } from '$lib/domain/playbook/materialize';
import { createItem, setItemStatus } from './itemRepository';
import {
	CannotRemovePlaybookFieldError,
	addCustomField,
	listFields,
	removeCustomField,
	setFieldValue
} from './fieldRepository';
import { ItemNotWritableError } from './writeGuards';

let tmpDir: string;
let db: Database.Database;
let itemId: string;
let cycleId: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-field-repo-'));
	db = openDatabase(path.join(tmpDir, 'test.sqlite'));
	const item = createItem(db, {
		title: 'Generic item',
		note: null,
		playbook: null,
		materialization: emptyMaterializationPlan()
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

describe('addCustomField', () => {
	it('adds a field with a c_ prefixed key and CUSTOM origin', () => {
		const field = addCustomField(db, cycleId, { label: 'Policy number', type: 'text' });
		expect(field.fieldKey).toBe('c_policy_number');
		expect(field.origin).toBe('CUSTOM');
		expect(field.recommended).toBe(false);
		expect(field.value).toBeNull();
	});

	it('appends after existing fields by position', () => {
		addCustomField(db, cycleId, { label: 'First', type: 'text' });
		const second = addCustomField(db, cycleId, { label: 'Second', type: 'date' });
		expect(second.position).toBe(1);
	});

	it('deduplicates a slug collision', () => {
		const a = addCustomField(db, cycleId, { label: 'Note', type: 'text' });
		const b = addCustomField(db, cycleId, { label: 'Note', type: 'text' });
		expect(a.fieldKey).not.toBe(b.fieldKey);
		expect(b.fieldKey).toBe('c_note_2');
	});

	it('falls back to a generic slug when the label has no alphanumeric characters', () => {
		const field = addCustomField(db, cycleId, { label: '😀😀', type: 'text' });
		expect(field.fieldKey).toBe('c_field');
	});

	it('deduplicates the generic-slug fallback too', () => {
		addCustomField(db, cycleId, { label: '😀😀', type: 'text' });
		const second = addCustomField(db, cycleId, { label: '!!!', type: 'text' });
		expect(second.fieldKey).toBe('c_field_2');
	});

	it('persists across a re-read', () => {
		addCustomField(db, cycleId, { label: 'Policy number', type: 'text' });
		const fields = listFields(db, cycleId);
		expect(fields.some((f) => f.fieldKey === 'c_policy_number')).toBe(true);
	});

	it('refuses to add a field once the item is archived, and adds no row (Slice 8 review, finding 2)', () => {
		setItemStatus(db, itemId, 'ARCHIVED');
		expect(() => addCustomField(db, cycleId, { label: 'Policy number', type: 'text' })).toThrow(
			ItemNotWritableError
		);
		expect(listFields(db, cycleId)).toEqual([]);
	});
});

describe('removeCustomField', () => {
	it('removes a CUSTOM field', () => {
		addCustomField(db, cycleId, { label: 'Temp', type: 'text' });
		removeCustomField(db, cycleId, 'c_temp');
		expect(listFields(db, cycleId)).toEqual([]);
	});

	it('is a no-op for an unknown field key', () => {
		expect(() => removeCustomField(db, cycleId, 'c_nope')).not.toThrow();
	});

	it('refuses to remove a PLAYBOOK-origin field', () => {
		db.prepare(
			`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, recommended, position, value)
			 VALUES ('f1', ?, 'valid_until', 'Valid until', 'date', 'PLAYBOOK', 1, 0, NULL)`
		).run(cycleId);
		expect(() => removeCustomField(db, cycleId, 'valid_until')).toThrow(
			CannotRemovePlaybookFieldError
		);
		expect(listFields(db, cycleId)).toHaveLength(1);
	});

	it('refuses to remove a field once the item is archived (Slice 8 review, finding 2)', () => {
		addCustomField(db, cycleId, { label: 'Temp', type: 'text' });
		setItemStatus(db, itemId, 'ARCHIVED');
		expect(() => removeCustomField(db, cycleId, 'c_temp')).toThrow(ItemNotWritableError);
		expect(listFields(db, cycleId)).toHaveLength(1);
	});
});

describe('setFieldValue', () => {
	it('sets and persists a value', () => {
		addCustomField(db, cycleId, { label: 'Note', type: 'text' });
		setFieldValue(db, cycleId, 'c_note', 'hello');
		expect(listFields(db, cycleId)[0].value).toBe('hello');
	});

	it('clears a value back to null', () => {
		addCustomField(db, cycleId, { label: 'Note', type: 'text' });
		setFieldValue(db, cycleId, 'c_note', 'hello');
		setFieldValue(db, cycleId, 'c_note', null);
		expect(listFields(db, cycleId)[0].value).toBeNull();
	});
});
