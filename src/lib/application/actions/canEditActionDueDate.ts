import type { Action } from '$lib/domain/action/action';

/** Shared eligibility for the Item detail and What's next due-date editors. */
export function canEditActionDueDate(
	action: Pick<Action, 'state' | 'dueKind' | 'dueDate' | 'dueOverrideDate'>
): boolean {
	return (
		action.state === 'OPEN' &&
		action.dueKind === 'DERIVED' &&
		(action.dueDate !== null || action.dueOverrideDate !== null)
	);
}
