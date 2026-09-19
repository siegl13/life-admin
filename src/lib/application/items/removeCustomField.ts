import { ItemHasNoActiveCycleError } from './updateItemFields';
import type { CycleRepositoryPort, FieldRepositoryPort } from '../ports';

export interface RemoveCustomFieldInput {
	itemId: string;
	fieldKey: string;
}

/**
 * Removes a user-added custom field. A PLAYBOOK-origin field can never
 * be removed this way — the repository enforces that and throws
 * CannotRemovePlaybookFieldError, which this use case deliberately lets
 * propagate rather than swallowing.
 */
export function removeCustomField(
	ports: { cycles: CycleRepositoryPort; fields: FieldRepositoryPort },
	input: RemoveCustomFieldInput
): void {
	const cycle = ports.cycles.getActiveCycle(input.itemId);
	if (!cycle) throw new ItemHasNoActiveCycleError(input.itemId);
	ports.fields.removeCustomField(cycle.id, input.fieldKey);
}
