import type { FieldType } from '../field/field';
import type { Offset } from '../date/offset';
import type { NormalizedPlaybook } from './normalize';

/**
 * The shape of "what rows to create" for a new item's first cycle, derived
 * purely from a normalized playbook (or empty, for a generic item with no
 * playbook). No IDs are assigned here — the repository assigns
 * crypto.randomUUID() ids and writes everything in one transaction.
 *
 * This is the only place that turns playbook data into
 * fields/events/actions/dependencies; it contains no domain-specific
 * knowledge, since everything comes from the (already-validated) playbook.
 */
export interface FieldPlan {
	fieldKey: string;
	label: string;
	/**
	 * label_i18n from the playbook, carried through unresolved: locale
	 * resolution is a presentation concern and deliberately happens at
	 * the infrastructure layer (itemRepository), not here — domain code
	 * has no notion of "current UI locale".
	 */
	labelI18n: Record<string, string>;
	type: FieldType;
	origin: 'PLAYBOOK';
	recommended: boolean;
	position: number;
	carryForward?: boolean;
	/** Initial group of this field, a `GroupPlan.groupKey`. Omitted means General. */
	groupKey?: string;
}

/**
 * Initial field group for a new item. Read at item creation only: from
 * then on the item owns its groups and nothing reads this plan again.
 */
export interface GroupPlan {
	groupKey: string;
	label: string;
	labelI18n: Record<string, string>;
	position: number;
}

export interface EventPlan {
	eventKey: string;
	label: string;
	labelI18n: Record<string, string>;
	sourceFieldKey: string;
	position: number;
}

export type ActionDuePlan =
	{ dueKind: 'NONE' } | { dueKind: 'DERIVED'; dueEventKey: string; dueOffset: Offset };

export interface ActionPlan {
	actionKey: string;
	label: string;
	labelI18n: Record<string, string>;
	description: string | null;
	due: ActionDuePlan;
	dependsOnActionKeys: string[];
	position: number;
}

export interface MaterializationPlan {
	fields: FieldPlan[];
	/** Initial groups; absent or empty means every field starts in General. */
	groups?: GroupPlan[];
	events: EventPlan[];
	actions: ActionPlan[];
}

export function materializePlaybook(playbook: NormalizedPlaybook): MaterializationPlan {
	return {
		fields: playbook.fields.map((field) => ({
			fieldKey: field.key,
			label: field.label,
			labelI18n: field.labelI18n,
			type: field.type,
			origin: 'PLAYBOOK',
			recommended: field.recommended,
			position: field.position,
			carryForward: field.carryForward,
			groupKey: field.group
		})),
		groups: (playbook.groups ?? []).map((group) => ({
			groupKey: group.key,
			label: group.label,
			labelI18n: group.labelI18n,
			position: group.position
		})),
		events: playbook.events.map((event) => ({
			eventKey: event.key,
			label: event.label,
			labelI18n: event.labelI18n,
			sourceFieldKey: event.sourceField,
			position: event.position
		})),
		actions: playbook.actions.map((action) => ({
			actionKey: action.key,
			label: action.label,
			labelI18n: action.labelI18n,
			description: action.description,
			due: action.due
				? { dueKind: 'DERIVED', dueEventKey: action.due.event, dueOffset: action.due.offset }
				: { dueKind: 'NONE' },
			dependsOnActionKeys: action.dependsOn,
			position: action.position
		}))
	};
}

/** The materialization plan for a generic item with no playbook at all. */
export function emptyMaterializationPlan(): MaterializationPlan {
	return { fields: [], events: [], actions: [] };
}
