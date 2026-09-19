import { isIsoDate } from '../../domain/date/isoDate';
import type { Action } from '../../domain/action/action';
import type { ActionRepositoryPort } from '../ports';

export class InvalidDueOverrideDateError extends Error {
	constructor(value: string) {
		super(`Due date override must be an ISO date (YYYY-MM-DD), got: ${value}`);
		this.name = 'InvalidDueOverrideDateError';
	}
}

export interface SetActionDueOverrideInput {
	itemId: string;
	actionId: string;
	/** `null` clears the override ("Auf Vorschlag zurücksetzen"); an
	 *  empty string is treated the same as `null` (a cleared date input
	 *  submits an empty value, not the field's absence). */
	dueDate: string | null;
}

/**
 * Sets or clears the user's override of a DERIVED action's calculated
 * due date. The repository proves at the write itself that the action
 * is DERIVED and belongs to `itemId`'s current ACTIVE cycle in an ACTIVE
 * item (`ActionNotMutableError` otherwise, one generic reason for every
 * cause — see actionRepository.setActionDueOverride).
 */
export function setActionDueOverride(
	ports: { actions: ActionRepositoryPort },
	input: SetActionDueOverrideInput
): Action {
	const trimmed = input.dueDate?.trim() || null;
	if (trimmed !== null && !isIsoDate(trimmed)) {
		throw new InvalidDueOverrideDateError(trimmed);
	}
	return ports.actions.setActionDueOverride(input.itemId, input.actionId, trimmed);
}
