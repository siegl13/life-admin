import type Database from 'better-sqlite3';
import { deriveSchedule } from '$lib/domain/action/schedule';
import { listActions } from './actionRepository';
import { listEvents } from './eventRepository';
import { listFields } from './fieldRepository';
import { assertCycleIsWritable } from './writeGuards';

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
