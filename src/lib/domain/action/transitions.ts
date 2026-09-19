import type { ActionState } from './action';

/**
 * Action lifecycle: OPEN -> DONE, OPEN -> SKIPPED, and either terminal
 * state back to OPEN (reopening — undoes a completion or skip click).
 * Reopening never cascades: a dependent action that already reached
 * DONE/SKIPPED while this one was complete stays as it is (see
 * `isAvailable` in dependencies.ts, which re-derives availability from
 * live dependency states rather than caching it).
 */
const ALLOWED_TRANSITIONS: Record<ActionState, ReadonlySet<ActionState>> = {
	OPEN: new Set<ActionState>(['DONE', 'SKIPPED']),
	DONE: new Set<ActionState>(['OPEN']),
	SKIPPED: new Set<ActionState>(['OPEN'])
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
