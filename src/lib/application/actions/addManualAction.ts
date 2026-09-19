import { isIsoDate, type IsoDate } from '../../domain/date/isoDate';
import type { Action } from '../../domain/action/action';
import { ItemHasNoActiveCycleError } from '../items/updateItemFields';
import type { ActionRepositoryPort, CycleRepositoryPort } from '../ports';

export class ManualActionLabelRequiredError extends Error {
	constructor() {
		super('Manual action label is required');
		this.name = 'ManualActionLabelRequiredError';
	}
}

export class InvalidManualDueDateError extends Error {
	constructor(value: string) {
		super(`Due date must be an ISO date (YYYY-MM-DD), got: ${value}`);
		this.name = 'InvalidManualDueDateError';
	}
}

export interface AddManualActionInput {
	itemId: string;
	label: string;
	/** Optional: a manual action may remain undated (decision D2). */
	dueDate?: string | null;
}

/**
 * Adds a user-created action to an item. Manual actions always belong to
 * an item's active cycle — there is no "add a free-floating task" entry
 * point anywhere in the UI, which is what keeps this from becoming a
 * generic task manager (see the "No orphan tasks" product invariant).
 */
export function addManualAction(
	ports: { cycles: CycleRepositoryPort; actions: ActionRepositoryPort },
	input: AddManualActionInput
): Action {
	const label = input.label.trim();
	if (!label) throw new ManualActionLabelRequiredError();

	const trimmedDate = input.dueDate?.trim() || null;
	let dueDate: IsoDate | null = null;
	if (trimmedDate !== null) {
		if (!isIsoDate(trimmedDate)) throw new InvalidManualDueDateError(trimmedDate);
		dueDate = trimmedDate;
	}

	const cycle = ports.cycles.getActiveCycle(input.itemId);
	if (!cycle) throw new ItemHasNoActiveCycleError(input.itemId);

	return ports.actions.addManualAction(cycle.id, { label, dueDate });
}
