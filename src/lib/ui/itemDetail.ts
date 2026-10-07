import { t } from '$lib/i18n';
import type { Action } from '$lib/domain/action/action';

/** UI eligibility shared by the hero and the existing workflow dialog. */
export function canEditActionDueDate(
	action: Pick<Action, 'state' | 'dueKind' | 'dueDate' | 'dueOverrideDate'>
): boolean {
	return (
		action.state === 'OPEN' &&
		action.dueKind === 'DERIVED' &&
		(action.dueDate !== null || action.dueOverrideDate !== null)
	);
}

export function formatWorkflowProgress(done: number, total: number): string {
	const key =
		total === 1 ? 'items.detail.workflowProgressOne' : 'items.detail.workflowProgressMany';
	return t(key, { done: String(done), total: String(total) });
}

export function formatEmptyFieldCount(count: number): string {
	const key = count === 1 ? 'items.detail.factsEmptyOne' : 'items.detail.factsEmpty';
	return t(key, { count: String(count) });
}
