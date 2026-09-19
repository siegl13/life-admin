import type { ActionState } from './action';

/**
 * V1 action lifecycle (see docs/adr and the approved plan, decision D6):
 * only OPEN -> DONE and OPEN -> SKIPPED are allowed. There is no reopening
 * in Slices 1-4; that is a deliberate scope cut, not an oversight.
 */
const ALLOWED_TRANSITIONS: Record<ActionState, ReadonlySet<ActionState>> = {
	OPEN: new Set<ActionState>(['DONE', 'SKIPPED']),
	DONE: new Set<ActionState>(),
	SKIPPED: new Set<ActionState>()
};

export class InvalidActionTransitionError extends Error {
	constructor(
		public readonly from: ActionState,
		public readonly to: ActionState
	) {
		super(`Cannot transition action from ${from} to ${to}`);
		this.name = 'InvalidActionTransitionError';
	}
}

export function canTransition(from: ActionState, to: ActionState): boolean {
	return ALLOWED_TRANSITIONS[from].has(to);
}

export function assertValidTransition(from: ActionState, to: ActionState): void {
	if (!canTransition(from, to)) {
		throw new InvalidActionTransitionError(from, to);
	}
}

/**
 * The states a transition to `to` may legally come from — the same
 * ALLOWED_TRANSITIONS table read in reverse. Lets a guarded repository
 * write express "only if currently mutable" as a plain `state IN (...)`
 * condition without re-encoding the transition rules as SQL (see
 * actionRepository.setActionState and the Slice 8 review, finding 1).
 */
export function statesThatCanTransitionTo(to: ActionState): ActionState[] {
	return (Object.keys(ALLOWED_TRANSITIONS) as ActionState[]).filter((from) =>
		ALLOWED_TRANSITIONS[from].has(to)
	);
}
