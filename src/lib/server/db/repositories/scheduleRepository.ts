import type Database from 'better-sqlite3';
import { deriveSchedule } from '$lib/domain/action/schedule';
import { listActions } from './actionRepository';
import { listEvents } from './eventRepository';
import { listFields } from './fieldRepository';
import { assertCycleIsWritable, assertItemIsWritable } from './writeGuards';
import { insert as insertHistoryEvent } from './itemHistoryRepository';
import { FieldGroupTargetNotFoundError } from './fieldGroupRepository';
import { UnknownFieldError } from '$lib/application/items/updateItemFields';

export interface FieldValueUpdate {
	fieldKey: string;
	value: string | null;
}

/**
 * Writes a set of field value changes and recalculates every dependent
 * event and DERIVED action due date, all in one transaction: either the
 * whole recalculation lands, or none of it does. NONE and MANUAL action
 * dates are never touched (see domain/action/schedule.ts).
 */
export function applyFieldUpdatesAndRecalculate(
	db: Database.Database,
	cycleId: string,
	updates: readonly FieldValueUpdate[]
): void {
	const run = db.transaction(() => {
		assertCycleIsWritable(db, cycleId);

		for (const update of updates) {
			db.prepare('UPDATE cycle_fields SET value = ? WHERE cycle_id = ? AND field_key = ?').run(
				update.value,
				cycleId,
				update.fieldKey
			);
		}

		const fields = listFields(db, cycleId);
		const events = listEvents(db, cycleId);
		const actions = listActions(db, cycleId);
		const { events: resolvedEvents, actions: resolvedActions } = deriveSchedule(
			fields,
			events,
			actions
		);

		for (const event of resolvedEvents) {
			db.prepare('UPDATE events SET resolved_date = ? WHERE cycle_id = ? AND event_key = ?').run(
				event.resolvedDate,
				cycleId,
				event.eventKey
			);
		}
		for (const action of resolvedActions) {
			db.prepare('UPDATE actions SET due_date = ? WHERE cycle_id = ? AND action_key = ?').run(
				action.dueDate,
				cycleId,
				action.actionKey
			);
		}
	});

	run();
}

/** Persists field values, group assignments, derived schedule changes, and
 * their Field-change History as one SQLite transaction. */
export function applyFieldUpdatesAndGroups(
	db: Database.Database,
	itemId: string,
	cycleId: string,
	updates: readonly FieldValueUpdate[],
	assignments: readonly { fieldKey: string; groupId: string }[],
	history: readonly { fieldKey: string; event: import('$lib/application/ports').ItemHistoryEvent }[]
): void {
	db.transaction(() => {
		assertItemIsWritable(db, itemId);
		assertCycleIsWritable(db, cycleId);
		const cycleBelongsToItem = db
			.prepare("SELECT 1 FROM cycles WHERE id = ? AND item_id = ? AND status = 'ACTIVE'")
			.get(cycleId, itemId);
		if (!cycleBelongsToItem) throw new FieldGroupTargetNotFoundError();

		const fieldsBefore = listFields(db, cycleId);
		const fieldsByKey = new Map(fieldsBefore.map((field) => [field.fieldKey, field]));
		for (const update of updates) {
			if (!fieldsByKey.has(update.fieldKey)) throw new UnknownFieldError(update.fieldKey);
		}
		for (const assignment of assignments) {
			if (!fieldsByKey.has(assignment.fieldKey)) throw new FieldGroupTargetNotFoundError();
			const group = db
				.prepare('SELECT 1 FROM item_field_groups WHERE id = ? AND item_id = ?')
				.get(assignment.groupId, itemId);
			if (!group) throw new FieldGroupTargetNotFoundError();
		}

		applyFieldUpdatesAndRecalculate(db, cycleId, updates);
		const upsert = db.prepare(
			`INSERT INTO item_field_group_assignments (item_id, field_key, group_id)
			 VALUES (?, ?, ?) ON CONFLICT (item_id, field_key) DO UPDATE SET group_id = excluded.group_id`
		);
		for (const assignment of assignments) {
			upsert.run(itemId, assignment.fieldKey, assignment.groupId);
		}

		const updatedValues = new Map(updates.map((update) => [update.fieldKey, update.value]));
		for (const entry of history) {
			if (fieldsByKey.get(entry.fieldKey)?.value === updatedValues.get(entry.fieldKey)) continue;
			insertHistoryEvent(db, entry.event);
		}
	})();
}
