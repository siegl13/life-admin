import type { Field } from './field';

/**
 * An item-owned, generic collection of fields. The default group
 * (`isDefault`, `label === null`) is the localized "General": every field
 * without an explicit assignment belongs to it. Groups belong to the item,
 * not to a cycle, and fields are assigned by `fieldKey`, so organization and
 * feature state carry over to every later cycle unchanged.
 */
export interface FieldGroup {
	id: string;
	itemId: string;
	/** `null` only for the default group, which renders as the localized "General". */
	label: string | null;
	isDefault: boolean;
	/** User-controlled. Never derived from time, domain or AI. */
	featured: boolean;
	position: number;
}

export interface FieldGroupAssignment {
	fieldKey: string;
	groupId: string;
}

export interface FieldGroupView {
	group: FieldGroup;
	/** All fields of the group in field position order, empty ones included. */
	fields: Field[];
	/** Fields with a value; what normal viewing shows. */
	filledFields: Field[];
	/** Fields without a value; hidden in normal viewing, still editable. */
	emptyFields: Field[];
}

export const MAX_FIELD_GROUP_LABEL_LENGTH = 80;

/** Featured groups first. Within each partition the stored position order is kept. */
export function orderFieldGroups(groups: readonly FieldGroup[]): FieldGroup[] {
	const byPosition = [...groups].sort((a, b) => a.position - b.position);
	return [...byPosition.filter((g) => g.featured), ...byPosition.filter((g) => !g.featured)];
}

function isFilled(field: Field): boolean {
	return field.value !== null && field.value !== '';
}

/**
 * Distributes fields over the item's groups. A field with no assignment, or
 * whose assignment points at an unknown group, falls back to the default
 * group, so a field is never lost from view. Returns groups in display order
 * and keeps groups that currently have no fields.
 */
export function groupFields(
	groups: readonly FieldGroup[],
	assignments: readonly FieldGroupAssignment[],
	fields: readonly Field[]
): FieldGroupView[] {
	const ordered = orderFieldGroups(groups);
	const fallback = groups.find((g) => g.isDefault) ?? ordered[0];
	if (!fallback) return [];

	const knownIds = new Set(groups.map((g) => g.id));
	const groupIdByKey = new Map(
		assignments.filter((a) => knownIds.has(a.groupId)).map((a) => [a.fieldKey, a.groupId])
	);
	const sortedFields = [...fields].sort((a, b) => a.position - b.position);

	return ordered.map((group) => {
		const own = sortedFields.filter(
			(field) => (groupIdByKey.get(field.fieldKey) ?? fallback.id) === group.id
		);
		return {
			group,
			fields: own,
			filledFields: own.filter(isFilled),
			emptyFields: own.filter((field) => !isFilled(field))
		};
	});
}
