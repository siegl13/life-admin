import type { CycleRepositoryPort, FieldRepositoryPort } from '../ports';
import { ItemHasNoActiveCycleError, UnknownFieldError } from './updateItemFields';

export interface SetFieldConfirmationInput {
	itemId: string;
	fieldKey: string;
	confirmed: boolean;
}

/**
 * Records the user's explicit confirmation (or its withdrawal) for one
 * field's current value. Each field has its own state: confirming one value
 * never touches another. A field without a value cannot be confirmed (the
 * repository throws `FieldNotConfirmableError`).
 */
export function setFieldConfirmation(
	ports: { cycles: CycleRepositoryPort; fields: FieldRepositoryPort },
	input: SetFieldConfirmationInput
): void {
	const cycle = ports.cycles.getActiveCycle(input.itemId);
	if (!cycle) throw new ItemHasNoActiveCycleError(input.itemId);
	if (!ports.fields.setFieldConfirmed(cycle.id, input.fieldKey, input.confirmed)) {
		throw new UnknownFieldError(input.fieldKey);
	}
}
