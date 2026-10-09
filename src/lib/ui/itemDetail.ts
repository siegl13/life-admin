import { t } from '$lib/i18n';
export { canEditActionDueDate } from '$lib/application/actions/canEditActionDueDate';

export function formatWorkflowProgress(done: number, total: number): string {
	const key =
		total === 1 ? 'items.detail.workflowProgressOne' : 'items.detail.workflowProgressMany';
	return t(key, { done: String(done), total: String(total) });
}

export function formatEmptyFieldCount(count: number): string {
	const key = count === 1 ? 'items.detail.factsEmptyOne' : 'items.detail.factsEmpty';
	return t(key, { count: String(count) });
}
