import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import { emptyMaterializationPlan } from '$lib/domain/playbook/materialize';
import { createItem, setItemStatus } from './itemRepository';
import {
	FieldNotConfirmableError,
	addCustomField,
	listFields,
	setFieldConfirmed
} from './fieldRepository';
import { applyFieldUpdatesAndRecalculate } from './scheduleRepository';
import { ItemNotWritableError } from './writeGuards';

let tmpDir: string;
let db: Database.Database;
let itemId: string;
let cycleId: string;

function field(fieldKey: string) {
	return listFields(db, cycleId).find((f) => f.fieldKey === fieldKey)!;
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-field-confirm-'));
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
	addCustomField(db, cycleId, { label: 'Pickup date', type: 'date' });
	addCustomField(db, cycleId, { label: 'Pickup time', type: 'text' });
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('field confirmation and source excerpt', () => {
	it('starts unconfirmed and without a source for a new and a legacy row', () => {
		expect(field('c_pickup_date')).toMatchObject({ confirmed: false, sourceText: null });
		// A row written before the columns existed has the column defaults.
		db.prepare(
			`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, recommended, position, value)
			 VALUES ('legacy', ?, 'legacy', 'Legacy', 'text', 'CUSTOM', 0, 9, 'old value')`
		).run(cycleId);
		expect(field('legacy')).toMatchObject({
			value: 'old value',
			confirmed: false,
			sourceText: null
		});
	});

	it('an extracted value is not confirmed and keeps its bounded excerpt', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'c_pickup_time', value: '12:30', sourceText: ' Abholung  um 12:30 Uhr ' }
		]);
		expect(field('c_pickup_time')).toMatchObject({
			value: '12:30',
			confirmed: false,
			sourceText: 'Abholung um 12:30 Uhr'
		});
	});

	it('stores no excerpt when it exceeds the bound or the value is manual', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'c_pickup_time', value: '12:30', sourceText: 'x'.repeat(301) },
			{ fieldKey: 'c_pickup_date', value: '2026-10-23' }
		]);
		expect(field('c_pickup_time').sourceText).toBeNull();
		expect(field('c_pickup_date').sourceText).toBeNull();
	});

	it('the database rejects an over-long excerpt even if the application did not', () => {
		expect(() =>
			db
				.prepare(`UPDATE cycle_fields SET source_text = ? WHERE field_key = 'c_pickup_time'`)
				.run('x'.repeat(301))
		).toThrow();
	});

	it('confirms date and time independently', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'c_pickup_date', value: '2026-10-23' },
			{ fieldKey: 'c_pickup_time', value: '12:30' }
		]);
		expect(setFieldConfirmed(db, cycleId, 'c_pickup_time', true)).toBe(true);
		expect(field('c_pickup_time').confirmed).toBe(true);
		expect(field('c_pickup_date').confirmed).toBe(false);

		setFieldConfirmed(db, cycleId, 'c_pickup_time', false);
		expect(field('c_pickup_time').confirmed).toBe(false);
	});

	it('a missing value cannot be confirmed, an unknown field reports false', () => {
		expect(() => setFieldConfirmed(db, cycleId, 'c_pickup_time', true)).toThrow(
			FieldNotConfirmableError
		);
		expect(field('c_pickup_time').confirmed).toBe(false);
		expect(setFieldConfirmed(db, cycleId, 'c_missing', true)).toBe(false);
	});

	it('a changed date resets only the date confirmation and its excerpt', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'c_pickup_date', value: '2026-10-23', sourceText: 'Datum: 23.10.2026' },
			{ fieldKey: 'c_pickup_time', value: '12:30', sourceText: 'Zeit: 12:30' }
		]);
		setFieldConfirmed(db, cycleId, 'c_pickup_date', true);
		setFieldConfirmed(db, cycleId, 'c_pickup_time', true);

		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'c_pickup_date', value: '2026-10-24' }
		]);

		expect(field('c_pickup_date')).toMatchObject({ confirmed: false, sourceText: null });
		expect(field('c_pickup_time')).toMatchObject({ confirmed: true, sourceText: 'Zeit: 12:30' });
	});

	it('a changed time resets only the time confirmation', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'c_pickup_date', value: '2026-10-23' },
			{ fieldKey: 'c_pickup_time', value: '12:30' }
		]);
		setFieldConfirmed(db, cycleId, 'c_pickup_date', true);
		setFieldConfirmed(db, cycleId, 'c_pickup_time', true);

		applyFieldUpdatesAndRecalculate(db, cycleId, [{ fieldKey: 'c_pickup_time', value: '13:00' }]);

		expect(field('c_pickup_time').confirmed).toBe(false);
		expect(field('c_pickup_date').confirmed).toBe(true);
	});

	it('saving an unchanged value keeps confirmation and excerpt, even when re-sent with an excerpt', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'c_pickup_time', value: '12:30', sourceText: 'Zeit: 12:30' }
		]);
		setFieldConfirmed(db, cycleId, 'c_pickup_time', true);

		applyFieldUpdatesAndRecalculate(db, cycleId, [{ fieldKey: 'c_pickup_time', value: '12:30' }]);
		expect(field('c_pickup_time')).toMatchObject({ confirmed: true, sourceText: 'Zeit: 12:30' });

		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'c_pickup_time', value: '12:30', sourceText: 'Anderer Beleg' }
		]);
		expect(field('c_pickup_time')).toMatchObject({ confirmed: true, sourceText: 'Zeit: 12:30' });
	});

	it('an identical extraction never attaches an excerpt to a manual value', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [{ fieldKey: 'c_pickup_time', value: '12:30' }]);
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'c_pickup_time', value: '12:30', sourceText: 'Zeit: 12:30' }
		]);
		expect(field('c_pickup_time').sourceText).toBeNull();
	});

	it('clearing a value resets confirmation and excerpt', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'c_pickup_time', value: '12:30', sourceText: 'Zeit: 12:30' }
		]);
		setFieldConfirmed(db, cycleId, 'c_pickup_time', true);
		applyFieldUpdatesAndRecalculate(db, cycleId, [{ fieldKey: 'c_pickup_time', value: null }]);
		expect(field('c_pickup_time')).toMatchObject({
			value: null,
			confirmed: false,
			sourceText: null
		});
	});

	it('keeps wall-clock time as stored text, independent of the process timezone', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [{ fieldKey: 'c_pickup_time', value: '12:30' }]);
		const previous = process.env.TZ;
		try {
			for (const tz of ['UTC', 'Pacific/Auckland', 'America/Los_Angeles']) {
				process.env.TZ = tz;
				expect(field('c_pickup_time').value).toBe('12:30');
			}
		} finally {
			if (previous === undefined) delete process.env.TZ;
			else process.env.TZ = previous;
		}
	});

	it('refuses confirmation and value writes on an archived item and changes nothing', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [{ fieldKey: 'c_pickup_time', value: '12:30' }]);
		setFieldConfirmed(db, cycleId, 'c_pickup_time', true);
		setItemStatus(db, itemId, 'ARCHIVED');

		expect(() => setFieldConfirmed(db, cycleId, 'c_pickup_time', false)).toThrow(
			ItemNotWritableError
		);
		expect(() =>
			applyFieldUpdatesAndRecalculate(db, cycleId, [{ fieldKey: 'c_pickup_time', value: '13:00' }])
		).toThrow(ItemNotWritableError);
		expect(field('c_pickup_time')).toMatchObject({ value: '12:30', confirmed: true });
	});

	it('rolls back a whole batch when one write fails, leaving confirmation untouched', () => {
		applyFieldUpdatesAndRecalculate(db, cycleId, [
			{ fieldKey: 'c_pickup_date', value: '2026-10-23' },
			{ fieldKey: 'c_pickup_time', value: '12:30' }
		]);
		setFieldConfirmed(db, cycleId, 'c_pickup_date', true);
		db.exec(`CREATE TRIGGER fail_time BEFORE UPDATE OF value ON cycle_fields
			WHEN NEW.field_key = 'c_pickup_time' BEGIN SELECT RAISE(ABORT, 'boom'); END`);

		expect(() =>
			applyFieldUpdatesAndRecalculate(db, cycleId, [
				{ fieldKey: 'c_pickup_date', value: '2026-10-24' },
				{ fieldKey: 'c_pickup_time', value: '13:00' }
			])
		).toThrow('boom');
		expect(field('c_pickup_date')).toMatchObject({ value: '2026-10-23', confirmed: true });
	});
});
