import {
	groupFields,
	MAX_FIELD_GROUP_LABEL_LENGTH,
	type FieldGroup,
	type FieldGroupView
} from '../../domain/field/fieldGroup';
import type { CycleRepositoryPort, FieldGroupRepositoryPort, FieldRepositoryPort } from '../ports';

/** A group named by a mutation does not belong to the item. */
export class FieldGroupTargetNotFoundError extends Error {
	constructor() {
		super('Field group target not found');
		this.name = 'FieldGroupTargetNotFoundError';
	}
}

export class FieldGroupLabelError extends Error {
	constructor() {
		super(`Group name is required and at most ${MAX_FIELD_GROUP_LABEL_LENGTH} characters`);
		this.name = 'FieldGroupLabelError';
	}
}

function normalizeLabel(raw: string): string {
	const label = raw.trim();
	if (!label || label.length > MAX_FIELD_GROUP_LABEL_LENGTH) throw new FieldGroupLabelError();
	return label;
}

/** The active cycle's fields distributed over the item's groups, featured groups first. */
export function loadFieldGroupViews(
	ports: {
		cycles: CycleRepositoryPort;
		fields: FieldRepositoryPort;
		fieldGroups: FieldGroupRepositoryPort;
	},
	itemId: string
): FieldGroupView[] {
	const cycle = ports.cycles.getActiveCycle(itemId);
	const fields = cycle ? ports.fields.listFields(cycle.id) : [];
	return groupFields(
		ports.fieldGroups.listGroups(itemId),
		ports.fieldGroups.listAssignments(itemId),
		fields
	);
}

export function createFieldGroup(
	ports: { fieldGroups: FieldGroupRepositoryPort },
	input: { itemId: string; label: string }
): FieldGroup {
	return ports.fieldGroups.createGroup(input.itemId, normalizeLabel(input.label));
}

export function renameFieldGroup(
	ports: { fieldGroups: FieldGroupRepositoryPort },
	input: { itemId: string; groupId: string; label: string }
): FieldGroup {
	return ports.fieldGroups.renameGroup(input.itemId, input.groupId, normalizeLabel(input.label));
}

export function moveFieldToGroup(
	ports: { fieldGroups: FieldGroupRepositoryPort },
	input: { itemId: string; fieldKey: string; groupId: string }
): void {
	ports.fieldGroups.moveField(input.itemId, input.fieldKey, input.groupId);
}

/** Feature state is only ever set by an explicit user action through this use case. */
export function setFieldGroupFeatured(
	ports: { fieldGroups: FieldGroupRepositoryPort },
	input: { itemId: string; groupId: string; featured: boolean }
): FieldGroup {
	return ports.fieldGroups.setFeatured(input.itemId, input.groupId, input.featured);
}

/**
 * Swaps a group with its neighbour in the same featured partition, so the
 * order inside the featured and the non-featured list stays what the user
 * sees. Groups of the other partition keep their stored positions.
 * Does nothing at the edge of its partition.
 */
export function moveFieldGroup(
	ports: { fieldGroups: FieldGroupRepositoryPort },
	input: { itemId: string; groupId: string; direction: 'up' | 'down' }
): void {
	const stored = [...ports.fieldGroups.listGroups(input.itemId)].sort(
		(a, b) => a.position - b.position
	);
	const group = stored.find((g) => g.id === input.groupId);
	if (!group) throw new FieldGroupTargetNotFoundError();
	const samePartition = stored.filter((g) => g.featured === group.featured);
	const neighbour =
		samePartition[samePartition.indexOf(group) + (input.direction === 'up' ? -1 : 1)];
	if (!neighbour) return;

	const ids = stored.map((g) => g.id);
	const from = ids.indexOf(group.id);
	const to = ids.indexOf(neighbour.id);
	[ids[from], ids[to]] = [ids[to], ids[from]];
	ports.fieldGroups.reorder(input.itemId, ids);
}

export function reorderFieldGroups(
	ports: { fieldGroups: FieldGroupRepositoryPort },
	input: { itemId: string; orderedGroupIds: string[] }
): void {
	ports.fieldGroups.reorder(input.itemId, input.orderedGroupIds);
}
