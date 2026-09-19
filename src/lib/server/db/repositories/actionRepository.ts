import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Action, ActionDependency, ActionState } from '$lib/domain/action/action';
import { statesThatCanTransitionTo } from '$lib/domain/action/transitions';
import { assertCycleIsWritable } from './writeGuards';

interface ActionRow {
	id: string;
	cycle_id: string;
	action_key: string;
	label: string;
	description: string | null;
	state: string;
	due_kind: string;
	due_event_key: string | null;
	due_offset: string | null;
	due_date: string | null;
	due_override_date: string | null;
	position: number;
	created_at: string;
	completed_at: string | null;
}

function mapAction(row: ActionRow): Action {
	const base = {
		id: row.id,
		cycleId: row.cycle_id,
		actionKey: row.action_key,
		label: row.label,
		description: row.description,
		state: row.state as ActionState,
		position: row.position,
		createdAt: row.created_at,
		completedAt: row.completed_at,
		dueOverrideDate: row.due_override_date
	};

	if (row.due_kind === 'DERIVED') {
		return {
			...base,
			dueKind: 'DERIVED',
			dueEventKey: row.due_event_key!,
			dueOffset: JSON.parse(row.due_offset!),
			dueDate: row.due_date
		};
	}
	if (row.due_kind === 'MANUAL') {
		return { ...base, dueKind: 'MANUAL', dueDate: row.due_date };
	}
	return { ...base, dueKind: 'NONE', dueDate: null };
}

export function listActions(db: Database.Database, cycleId: string): Action[] {
	const rows = db
		.prepare('SELECT * FROM actions WHERE cycle_id = ? ORDER BY position')
		.all(cycleId) as ActionRow[];
	return rows.map(mapAction);
}

export function getAction(db: Database.Database, actionId: string): Action | null {
	const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId) as
		ActionRow | undefined;
	return row ? mapAction(row) : null;
}

export function listDependencies(db: Database.Database, cycleId: string): ActionDependency[] {
	const rows = db
		.prepare(
			`SELECT ad.action_id, ad.depends_on_action_id
			 FROM action_dependencies ad
			 JOIN actions a ON a.id = ad.action_id
			 WHERE a.cycle_id = ?`
		)
		.all(cycleId) as { action_id: string; depends_on_action_id: string }[];
	return rows.map((r) => ({ actionId: r.action_id, dependsOnActionId: r.depends_on_action_id }));
}

export class ActionNotFoundError extends Error {
	constructor(actionId: string) {
		super(`Action not found: ${actionId}`);
		this.name = 'ActionNotFoundError';
	}
}

/**
 * Thrown whenever `setActionState`'s guarded UPDATE affects zero rows.
 * Deliberately one error for every possible reason — wrong item, an
 * archived item, an inactive cycle, a stale/unknown action id, or an
 * already-DONE/SKIPPED action — so the caller can never learn which one
 * it was (see the Slice 8 review, finding 1).
 */
export class ActionNotMutableError extends Error {
	constructor() {
		super('Action is not currently mutable');
		this.name = 'ActionNotMutableError';
	}
}

/**
 * Transitions an action's state — but only if `actionId` truly belongs to
 * `itemId`'s current ACTIVE cycle, that item is itself ACTIVE, and the
 * action's current state legally allows the target state. All three
 * checks and the write are ONE statement: there is no separate read to
 * race against a concurrent archive/rollover (Slice 8 review, finding 1).
 * OPEN -> DONE, OPEN -> SKIPPED, and DONE/SKIPPED -> OPEN (reopening) are
 * allowed — see domain/action/transitions.ts, whose own transition table
 * this reads via `statesThatCanTransitionTo` rather than re-encoding it.
 * `completed_at` is cleared back to NULL on reopen, since it is no
 * longer completed.
 */
export function setActionState(
	db: Database.Database,
	itemId: string,
	actionId: string,
	newState: ActionState,
	now = new Date().toISOString()
): Action {
	const validFromStates = statesThatCanTransitionTo(newState);
	const statePlaceholders = validFromStates.map(() => '?').join(',');
	const completedAt = newState === 'OPEN' ? null : now;

	const result = db
		.prepare(
			`UPDATE actions
			 SET state = ?, completed_at = ?
			 WHERE id = ?
			   AND state IN (${statePlaceholders})
			   AND EXISTS (
			     SELECT 1 FROM cycles c
			     JOIN items i ON i.id = c.item_id
			     WHERE c.id = actions.cycle_id
			       AND c.item_id = ?
			       AND c.status = 'ACTIVE'
			       AND i.status = 'ACTIVE'
			   )`
		)
		.run(newState, completedAt, actionId, ...validFromStates, itemId);

	if (result.changes !== 1) throw new ActionNotMutableError();
	return getAction(db, actionId)!;
}

/**
 * Sets or clears a DERIVED action's due-date override — the same
 * guarded shape as {@link setActionState}: one statement proves the
 * action belongs to `itemId`'s current ACTIVE cycle, that item is
 * ACTIVE, and the action is DERIVED (a MANUAL/NONE action has no
 * playbook suggestion to override, so this is restricted to DERIVED at
 * the write itself, not only in the UI). `overrideDate: null` clears the
 * override back to "use the calculated date" (the "Auf Vorschlag
 * zurücksetzen" action). Zero affected rows throws the same
 * `ActionNotMutableError` as `setActionState`, for the same reason:
 * never reveal whether the cause was a wrong item, an archived item, an
 * inactive cycle, a stale id, or a non-DERIVED action.
 */
export function setActionDueOverride(
	db: Database.Database,
	itemId: string,
	actionId: string,
	overrideDate: string | null
): Action {
	const result = db
		.prepare(
			`UPDATE actions
			 SET due_override_date = ?
			 WHERE id = ?
			   AND due_kind = 'DERIVED'
			   AND EXISTS (
			     SELECT 1 FROM cycles c
			     JOIN items i ON i.id = c.item_id
			     WHERE c.id = actions.cycle_id
			       AND c.item_id = ?
			       AND c.status = 'ACTIVE'
			       AND i.status = 'ACTIVE'
			   )`
		)
		.run(overrideDate, actionId, itemId);

	if (result.changes !== 1) throw new ActionNotMutableError();
	return getAction(db, actionId)!;
}

export interface AddManualActionInput {
	label: string;
	dueDate: string | null;
}

/**
 * Adds a user-created action to a cycle. Manual actions always belong to
 * an item's cycle (never a free-floating task) and have no dependencies
 * in V1. `actionKey` is prefixed `m_` so it can never collide with a
 * playbook-authored action key (which the playbook schema forbids from
 * using that prefix).
 *
 * Guarded by `assertCycleIsWritable` inside the same transaction as the
 * insert: an item archived between the caller resolving its active cycle
 * and this write landing must not gain a new manual action (Slice 8
 * review, finding 2).
 */
export function addManualAction(
	db: Database.Database,
	cycleId: string,
	input: AddManualActionInput
): Action {
	return db.transaction(() => {
		assertCycleIsWritable(db, cycleId);

		const existing = listActions(db, cycleId);
		const maxPosition = existing.reduce((max, a) => Math.max(max, a.position), -1);
		const position = maxPosition + 1;
		const id = crypto.randomUUID();
		const actionKey = `m_${crypto.randomUUID().slice(0, 8)}`;
		const now = new Date().toISOString();
		const label = input.label.trim();

		db.prepare(
			`INSERT INTO actions (id, cycle_id, action_key, label, description, state, due_kind, due_event_key, due_offset, due_date, position, created_at, completed_at)
			 VALUES (?, ?, ?, ?, NULL, 'OPEN', 'MANUAL', NULL, NULL, ?, ?, ?, NULL)`
		).run(id, cycleId, actionKey, label, input.dueDate, position, now);

		return getAction(db, id)!;
	})();
}
