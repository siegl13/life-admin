import type { FieldType } from '../field/field';
import type { Offset } from '../date/offset';
import type { RawPlaybook } from './schema';

/**
 * The normalized, versioned shape of a playbook. This is what gets
 * snapshotted verbatim into items.playbook_snapshot at item-creation time
 * (see docs/adr/0004) and is also what materialize.ts consumes to create
 * an item's fields/events/actions/dependencies.
 *
 * Normalization only trims strings and assigns a stable `position` per
 * collection (declaration order) — it does not resolve labels to a
 * locale. Locale resolution happens at render time from label_i18n.
 */
export interface NormalizedField {
	key: string;
	type: FieldType;
	label: string;
	labelI18n: Record<string, string>;
	recommended: boolean;
	position: number;
	carryForward?: boolean;
}

export interface NormalizedEvent {
	key: string;
	label: string;
	labelI18n: Record<string, string>;
	sourceField: string;
	position: number;
}

export interface NormalizedActionDue {
	event: string;
	offset: Offset;
}

export interface NormalizedAction {
	key: string;
	label: string;
	labelI18n: Record<string, string>;
	description: string | null;
	due: NormalizedActionDue | null;
	dependsOn: string[];
	position: number;
}

export interface NormalizedPlaybook {
	schemaVersion: 1;
	id: string;
	version: string;
	name: string;
	labelI18n: Record<string, string>;
	description: string | null;
	locale: string | null;
	category: string | null;
	fields: NormalizedField[];
	events: NormalizedEvent[];
	actions: NormalizedAction[];
}

function trim(value: string): string {
	return value.trim();
}

export function normalizePlaybook(raw: RawPlaybook): NormalizedPlaybook {
	return {
		schemaVersion: 1,
		id: raw.id,
		version: raw.version,
		name: trim(raw.name),
		labelI18n: raw.label_i18n ?? {},
		description: raw.description ? trim(raw.description) : null,
		locale: raw.locale ?? null,
		category: raw.category ?? null,
		fields: raw.fields.map((field, index) => ({
			key: field.key,
			type: field.type,
			label: trim(field.label),
			labelI18n: field.label_i18n ?? {},
			recommended: field.recommended,
			carryForward: field.carryForward,
			position: index
		})),
		events: raw.events.map((event, index) => ({
			key: event.key,
			label: trim(event.label),
			labelI18n: event.label_i18n ?? {},
			sourceField: event.sourceField,
			position: index
		})),
		actions: raw.actions.map((action, index) => ({
			key: action.key,
			label: trim(action.label),
			labelI18n: action.label_i18n ?? {},
			description: action.description ? trim(action.description) : null,
			due: action.due ? { event: action.due.event, offset: action.due.offset } : null,
			dependsOn: action.dependsOn ?? [],
			position: index
		}))
	};
}
