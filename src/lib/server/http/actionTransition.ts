import { fail, type ActionFailure } from '@sveltejs/kit';
import { setActionState } from '$lib/application/actions/setActionState';
import { recordHistoryEvent } from '$lib/application/history/itemHistory';
import { ActionNotMutableError } from '$lib/server/db/repositories/actionRepository';
import type { Action, ActionState } from '$lib/domain/action/action';
import type { ActionRepositoryPort } from '$lib/application/ports';
import type { ItemHistoryRepositoryPort } from '$lib/application/ports';
import type { Clock } from '$lib/application/ports';

export { ActionNotMutableError };

const TRANSITION_EVENT_TYPE = {
	DONE: 'ACTION_COMPLETED',
	SKIPPED: 'ACTION_SKIPPED',
	OPEN: 'ACTION_REOPENED'
} as const;

export interface ActionTransitionPorts {
	actions: ActionRepositoryPort;
	history: ItemHistoryRepositoryPort;
	ids: { newId: () => string };
	clock: Clock;
}

export interface ActionTransitionInput {
	itemId: string;
	actionId: string;
	newState: ActionState;
}

export interface ParsedTransitionForm {
	itemId: string;
	actionId: string;
}

/** `null` means a required field is missing — the caller renders its own
 *  400 message, which may differ between routes (root needs `itemId` in
 *  the form since it has no `params.id`; the detail route trusts its own
 *  URL param instead). */
export function parseTransitionFormData(
	formData: FormData,
	opts: { requireItemId: boolean }
): ParsedTransitionForm | null {
	const actionId = formData.get('actionId')?.toString();
	const itemId = formData.get('itemId')?.toString();
	if (!actionId) return null;
	if (opts.requireItemId && !itemId) return null;
	return { itemId: itemId ?? '', actionId };
}

/**
 * The one place that owns "move an Action to DONE/SKIPPED/OPEN, then
 * record the matching history event" — shared by the item-detail route
 * and the What's Next root route so both guard the same way and never
 * record history without a confirmed state change. A history failure
 * propagates after the durable transition, without implying a rollback. A
 * rejected transition (wrong item, archived item, inactive cycle, stale
 * id, invalid transition) throws {@link ActionNotMutableError} and
 * records nothing; callers map that to one generic user-facing message
 * (see the Slice 8 review, finding 1).
 */
export function applyActionTransition(
	ports: ActionTransitionPorts,
	input: ActionTransitionInput
): Action {
	const action = setActionState({ actions: ports.actions }, input);
	recordHistoryEvent(
		{ history: ports.history, ids: ports.ids, clock: ports.clock },
		{
			itemId: input.itemId,
			actorKind: 'OWNER',
			eventType: TRANSITION_EVENT_TYPE[input.newState],
			payload: { actionId: input.actionId }
		}
	);
	return action;
}

/**
 * Same as {@link applyActionTransition}, but also owns the one error
 * mapping every caller (root's completeAction/skipAction/reopenAction,
 * its cookie-based undoAction, and the item-detail route) needs: a
 * rejected transition becomes a rendered 400 with `notMutableMessage`;
 * anything else still propagates unhandled, never swallowed. Centralizing
 * this means the three call sites can no longer drift into different
 * wording or accidentally catch an error they shouldn't.
 */
export function applyGuardedTransition(
	ports: ActionTransitionPorts,
	input: ActionTransitionInput,
	notMutableMessage: string
): Action | ActionFailure<{ error: string }> {
	try {
		return applyActionTransition(ports, input);
	} catch (err) {
		if (err instanceof ActionNotMutableError) {
			return fail(400, { error: notMutableMessage });
		}
		throw err;
	}
}

/**
 * `@sveltejs/kit`'s own `isActionFailure` narrows to `ActionFailure`
 * (generic defaulted to `undefined`), which does not narrow a
 * `T | ActionFailure<{ error: string }>` union's negative branch — a
 * failure with a non-`undefined` payload isn't assignable to
 * `ActionFailure<undefined>`, so TypeScript can't exclude it after the
 * guard. This local, generic-preserving equivalent checks the same
 * runtime shape instead.
 */
export function isTransitionFailure<T>(
	result: T | ActionFailure<{ error: string }>
): result is ActionFailure<{ error: string }> {
	return typeof result === 'object' && result !== null && 'status' in result && 'data' in result;
}
