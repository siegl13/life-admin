import type { IsoDate } from '../date/isoDate';
import type { Offset } from '../date/offset';

export type ActionState = 'OPEN' | 'DONE' | 'SKIPPED';

/**
 * How an Action's due date is determined:
 *
 * - NONE: a workflow step with no date of its own (e.g. "Check receipt").
 *   It becomes available as soon as its dependencies are resolved and is
 *   never considered "unresolved" — it simply has no due date.
 * - DERIVED: computed from an Event plus an Offset. While that event's
 *   date is unknown, `dueDate` is null and the action MUST NOT be treated
 *   as available/due — it is unresolved, not undated.
 * - MANUAL: a user-created action. `dueDate` is an optional value the
 *   user typed in directly; it is never recalculated.
 */
export type DueKind = 'NONE' | 'DERIVED' | 'MANUAL';

interface ActionDueNone {
	dueKind: 'NONE';
	dueDate: null;
}

interface ActionDueDerived {
	dueKind: 'DERIVED';
	dueEventKey: string;
	dueOffset: Offset;
	/** null until the source event's date is known. */
	dueDate: IsoDate | null;
}

interface ActionDueManual {
	dueKind: 'MANUAL';
	/** Optional: a manual action may remain undated. */
	dueDate: IsoDate | null;
}

export type ActionDue = ActionDueNone | ActionDueDerived | ActionDueManual;

export type Action = {
	id: string;
	cycleId: string;
	actionKey: string;
	label: string;
	description: string | null;
	state: ActionState;
	position: number;
	createdAt: string;
	completedAt: string | null;
	/**
	 * A user-entered override of a DERIVED action's calculated due date
	 * ("the playbook calculates the default, the user has the final
	 * say"). Always null for NONE/MANUAL actions — nothing ever writes it
	 * there. Never read directly outside {@link effectiveDueDate}: every
	 * place that reasons about "when is this due" must go through that
	 * one function instead of re-deriving the precedence rule.
	 */
	dueOverrideDate: IsoDate | null;
} & ActionDue;

export interface ActionDependency {
	actionId: string;
	dependsOnActionId: string;
}

/**
 * True once an action's date is known well enough to be treated as due
 * ("resolved"). NONE actions have no date and are always resolved; DERIVED
 * actions are resolved only once their event date is known; MANUAL actions
 * are always resolved (an absent date just means "no due date").
 */
export function hasResolvedDue(action: Pick<Action, 'dueKind' | 'dueDate'>): boolean {
	return action.dueKind !== 'DERIVED' || action.dueDate !== null;
}

/**
 * The date an action is actually due: the user's override when one is
 * set, otherwise the calculated (playbook-derived or manually entered)
 * date. This is the ONE place the precedence rule lives — every UI and
 * every ranking/overdue computation must read a due date through this
 * function rather than `action.dueDate` directly, so the rule can never
 * drift between call sites.
 *
 * Deliberately NOT used for availability (`hasResolvedDue`/`isAvailable`):
 * whether an action is "ready now" stays derived from dependencies and
 * the calculated date alone. An override changes what date is shown and
 * how the action sorts, not whether it is unlocked yet.
 */
export function effectiveDueDate(
	action: Pick<Action, 'dueDate' | 'dueOverrideDate'>
): IsoDate | null {
	return action.dueOverrideDate ?? action.dueDate;
}
