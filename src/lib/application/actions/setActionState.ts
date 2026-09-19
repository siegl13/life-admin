import type { Action, ActionState } from '../../domain/action/action';
import type { ActionRepositoryPort } from '../ports';

export interface SetActionStateInput {
	itemId: string;
	actionId: string;
	newState: ActionState;
}

/**
 * Marks an action DONE, SKIPPED, or reopens a DONE/SKIPPED action back to
 * OPEN. `itemId` is not a hint —
 * the repository's guarded write only succeeds if `actionId` truly
 * belongs to `itemId`'s current ACTIVE cycle and that item is ACTIVE
 * (Slice 8 review, finding 1); any other case, including an invalid
 * transition, is rejected as `ActionNotMutableError` and left to
 * propagate — the route layer maps it to one generic user-facing message.
 */
export function setActionState(
	ports: { actions: ActionRepositoryPort },
	input: SetActionStateInput
): Action {
	return ports.actions.setActionState(input.itemId, input.actionId, input.newState);
}
