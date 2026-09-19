import type { Field, FieldType } from '../../domain/field/field';
import { ItemHasNoActiveCycleError } from './updateItemFields';
import type { CycleRepositoryPort, FieldRepositoryPort } from '../ports';

export class FieldLabelRequiredError extends Error {
	constructor() {
		super('Field label is required');
		this.name = 'FieldLabelRequiredError';
	}
}

export interface AddCustomFieldInput {
	itemId: string;
	label: string;
	type: FieldType;
}

/**
 * Adds a user-defined field to an item's active cycle. Custom fields
 * render through the same generic FieldInput as playbook fields — only
 * `origin` differs (see docs/adr and the approved plan, decision D9).
 */
export function addCustomField(
	ports: { cycles: CycleRepositoryPort; fields: FieldRepositoryPort },
	input: AddCustomFieldInput
): Field {
	const label = input.label.trim();
	if (!label) throw new FieldLabelRequiredError();

	const cycle = ports.cycles.getActiveCycle(input.itemId);
	if (!cycle) throw new ItemHasNoActiveCycleError(input.itemId);

	return ports.fields.addCustomField(cycle.id, { label, type: input.type });
}
