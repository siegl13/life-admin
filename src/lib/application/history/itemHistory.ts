import type { Clock, IdGeneratorPort, ItemHistoryRepositoryPort } from '../ports';
import type {
	HistoryActorKind,
	HistoryEventPayload,
	HistoryEventType
} from '../../domain/history/historyEvent';
import { ALLOWED_EVENT_TYPES } from '../../domain/history/historyEvent';

export interface RecordHistoryEventInput {
	itemId: string;
	actorKind: HistoryActorKind;
	eventType: HistoryEventType;
	payload?: HistoryEventPayload;
}

export function recordHistoryEvent(
	ports: {
		history: ItemHistoryRepositoryPort;
		ids: IdGeneratorPort;
		clock: Clock;
	},
	input: RecordHistoryEventInput
): void {
	if (!ALLOWED_EVENT_TYPES.includes(input.eventType)) {
		throw new Error(`Unknown history event type: ${input.eventType}`);
	}
	const payload = input.payload ? JSON.stringify(input.payload) : '{}';
	ports.history.insert({
		id: ports.ids.newId(),
		itemId: input.itemId,
		actorKind: input.actorKind,
		eventType: input.eventType,
		payload,
		createdAt: ports.clock.nowIso()
	});
}

export interface HistoryEventView {
	id: string;
	itemId: string;
	actorKind: HistoryActorKind;
	eventType: HistoryEventType;
	payload: HistoryEventPayload;
	createdAt: string;
	/** The current label of a `FIELD_CHANGED` event's field, resolved at
	 *  read time against `input.fields` — never stored on the event itself
	 *  (see docs/roadmap-next.md's Security/privacy section: a field event
	 *  stores only its internal id, not its label or value). `null` when
	 *  the event isn't a field change, or the field no longer exists
	 *  (removed, or from an earlier cycle) — callers fall back to generic
	 *  wording in that case. */
	fieldLabel: string | null;
}

export function loadItemHistory(
	ports: { history: ItemHistoryRepositoryPort },
	input: {
		itemId: string;
		limit: number;
		offset: number;
		fields?: readonly { fieldKey: string; label: string }[];
	}
): HistoryEventView[] {
	const labelsByFieldKey = new Map((input.fields ?? []).map((f) => [f.fieldKey, f.label]));
	const events = ports.history.listByItem(input.itemId, input.limit, input.offset);
	return events.map((e) => {
		const payload = safeParsePayload(e.payload);
		const fieldKey =
			e.eventType === 'FIELD_CHANGED' && 'fieldKey' in payload
				? (payload as { fieldKey: string }).fieldKey
				: null;
		return {
			id: e.id,
			itemId: e.itemId,
			actorKind: e.actorKind,
			eventType: e.eventType,
			payload,
			createdAt: e.createdAt,
			fieldLabel: fieldKey ? (labelsByFieldKey.get(fieldKey) ?? null) : null
		};
	});
}

export function countItemHistory(
	ports: { history: ItemHistoryRepositoryPort },
	itemId: string
): number {
	return ports.history.countByItem(itemId);
}

function safeParsePayload(raw: string): HistoryEventPayload {
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as HistoryEventPayload;
		}
	} catch {
		// ignore
	}
	return {};
}
