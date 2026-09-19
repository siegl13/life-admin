import type { Field, FieldOrigin, FieldType } from '../field/field';
import type { MaterializationPlan } from '../playbook/materialize';

export interface NextCycleFieldSeed {
	fieldKey: string;
	label: string;
	type: FieldType;
	origin: FieldOrigin;
	recommended: boolean;
	position: number;
	value: string | null;
}

/**
 * Carry-forward rule. Two layers, in this order:
 *
 *   1. If the field's plan carries an EXPLICIT carryForward boolean, use it.
 *   2. Otherwise fall back to the generic, type-driven default:
 *        text -> the previous value carries over
 *        date -> the value resets to null
 *
 * A value is carried only when the field key AND the field type match, so a
 * future "use the newer playbook version" feature cannot move a text value
 * into a date column. CUSTOM fields have no explicit override in V1 and
 * always use the type-driven fallback.
 */
export function planNextCycleFields(
	plan: MaterializationPlan,
	previousFields: readonly Field[]
): NextCycleFieldSeed[] {
	const previousByKey = new Map(previousFields.map((field) => [field.fieldKey, field]));

	const seeds: NextCycleFieldSeed[] = plan.fields.map((field) => {
		const previous = previousByKey.get(field.fieldKey);
		const carries = field.carryForward ?? field.type === 'text';
		const value = previous && previous.type === field.type && carries ? previous.value : null;
		return {
			fieldKey: field.fieldKey,
			label: field.label,
			type: field.type,
			origin: 'PLAYBOOK',
			recommended: field.recommended,
			position: field.position,
			value
		};
	});

	const seededKeys = new Set(seeds.map((seed) => seed.fieldKey));
	let nextPosition = seeds.length;
	for (const field of previousFields) {
		if (field.origin !== 'CUSTOM' || seededKeys.has(field.fieldKey)) continue;
		seeds.push({
			fieldKey: field.fieldKey,
			label: field.label,
			type: field.type,
			origin: 'CUSTOM',
			recommended: field.recommended,
			position: nextPosition++,
			value: field.type === 'text' ? field.value : null
		});
	}

	return seeds;
}
