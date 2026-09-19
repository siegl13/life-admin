import type { Field } from '$lib/domain/field/field';
import type {
	ActionRepositoryPort,
	AttachmentRepositoryPort,
	CycleRepositoryPort,
	EventRepositoryPort,
	FieldRepositoryPort,
	ItemRelationRepositoryPort
} from '../ports';
import { getItemWorkflow, type WorkflowAction } from './getItemWorkflow';

export interface ItemOverview {
	nextAction: WorkflowAction | null;
	importantFields: Field[];
	documentCount: number;
	relationCount: number;
}

export function loadItemOverview(
	ports: {
		cycles: CycleRepositoryPort;
		actions: ActionRepositoryPort;
		events: EventRepositoryPort;
		fields: FieldRepositoryPort;
		attachments: AttachmentRepositoryPort;
		relations: ItemRelationRepositoryPort;
	},
	itemId: string
): ItemOverview {
	const workflow = getItemWorkflow(ports, itemId) ?? [];
	const cycle = ports.cycles.getActiveCycle(itemId);
	const importantFields = (cycle ? ports.fields.listFields(cycle.id) : [])
		.filter((field) => field.origin === 'PLAYBOOK' && field.value !== null && field.value !== '')
		.slice(0, 3);
	return {
		nextAction: workflow.find((entry) => entry.action.state === 'OPEN' && entry.available) ?? null,
		importantFields,
		documentCount: ports.attachments.countByItem(itemId),
		relationCount: ports.relations.countRelated(itemId)
	};
}
