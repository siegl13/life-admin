import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import type { ActionPlan, EventPlan } from '$lib/domain/playbook/materialize';
import type { FieldOrigin, FieldType } from '$lib/domain/field/field';

export interface CycleFieldSeed {
	fieldKey: string;
	label: string;
	type: FieldType;
	origin: FieldOrigin;
	recommended: boolean;
	position: number;
	value: string | null;
}

/**
 * Inserts one cycle's fields/events/actions/dependencies. Shared by
 * `createItem` (cycle 1, every field's value always NULL) and
 * `startNextCycle` (Slice 8, values seeded by `planNextCycleFields`) so
 * both paths write rows through the identical statements — keeping
 * `createItem`'s existing transactional-rollback test meaningful for the
 * rollover path too, instead of duplicating four near-identical insert
 * loops that could silently drift apart.
 */
export function insertCycleContents(
	db: Database.Database,
	cycleId: string,
	content: { fields: CycleFieldSeed[]; events: EventPlan[]; actions: ActionPlan[] },
	now: string
): void {
	for (const field of content.fields) {
		db.prepare(
			`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, recommended, position, value)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			crypto.randomUUID(),
			cycleId,
			field.fieldKey,
			field.label,
			field.type,
			field.origin,
			field.recommended ? 1 : 0,
			field.position,
			field.value
		);
	}

	for (const event of content.events) {
		db.prepare(
			`INSERT INTO events (id, cycle_id, event_key, label, source_field_key, resolved_date, position)
			 VALUES (?, ?, ?, ?, ?, NULL, ?)`
		).run(
			crypto.randomUUID(),
			cycleId,
			event.eventKey,
			event.label,
			event.sourceFieldKey,
			event.position
		);
	}

	const actionIdByKey = new Map<string, string>();
	for (const action of content.actions) {
		const id = crypto.randomUUID();
		actionIdByKey.set(action.actionKey, id);
		const due = action.due;
		db.prepare(
			`INSERT INTO actions (id, cycle_id, action_key, label, description, state, due_kind, due_event_key, due_offset, due_date, position, created_at, completed_at)
			 VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, NULL, ?, ?, NULL)`
		).run(
			id,
			cycleId,
			action.actionKey,
			action.label,
			action.description,
			due.dueKind,
			due.dueKind === 'DERIVED' ? due.dueEventKey : null,
			due.dueKind === 'DERIVED' ? JSON.stringify(due.dueOffset) : null,
			action.position,
			now
		);
	}

	for (const action of content.actions) {
		const actionId = actionIdByKey.get(action.actionKey)!;
		for (const dependsOnKey of action.dependsOnActionKeys) {
			const dependsOnId = actionIdByKey.get(dependsOnKey);
			// Semantic validation already guarantees every dependsOn key
			// resolves to a known action; this guard is defense in depth,
			// not the primary safeguard.
			if (!dependsOnId) continue;
			db.prepare(
				`INSERT INTO action_dependencies (action_id, depends_on_action_id) VALUES (?, ?)`
			).run(actionId, dependsOnId);
		}
	}
}
