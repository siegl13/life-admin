import { applyOffset, type IsoDate } from '../date/isoDate';
import type { Event } from '../event/event';
import type { Field } from '../field/field';
import type { Action } from './action';

export interface EventResolution {
	eventKey: string;
	resolvedDate: IsoDate | null;
}

export interface ActionDueResolution {
	actionKey: string;
	dueDate: IsoDate | null;
}

/**
 * Recomputes every event's resolved date from its source field's current
 * value. Pure: takes the current fields and events, returns what each
 * event's resolved date should now be. Does not touch state.
 */
export function resolveEvents(
	fields: readonly Field[],
	events: readonly Event[]
): EventResolution[] {
	const fieldByKey = new Map(fields.map((f) => [f.fieldKey, f]));
	return events.map((event) => {
		const source = fieldByKey.get(event.sourceFieldKey);
		const value = source?.value ?? null;
		return {
			eventKey: event.eventKey,
			resolvedDate: value && typeof value === 'string' ? value : null
		};
	});
}

/**
 * Recomputes the due date of every DERIVED action from the (already
 * resolved) events. NONE and MANUAL actions are returned unchanged: their
 * dates are either absent by design or entered by hand, never derived.
 *
 * Action state is never touched here — a DONE action keeps its state and
 * simply gets its date recomputed, because dates describe facts and
 * completion describes what the user did.
 */
export function deriveActionDueDates(
	actions: readonly Action[],
	resolvedEvents: readonly EventResolution[]
): ActionDueResolution[] {
	const eventByKey = new Map(resolvedEvents.map((e) => [e.eventKey, e.resolvedDate]));
	return actions
		.filter((a): a is Action & { dueKind: 'DERIVED' } => a.dueKind === 'DERIVED')
		.map((action) => {
			const eventDate = eventByKey.get(action.dueEventKey) ?? null;
			const dueDate = eventDate ? applyOffset(eventDate, action.dueOffset) : null;
			return { actionKey: action.actionKey, dueDate };
		});
}

/**
 * Convenience wrapper combining {@link resolveEvents} and
 * {@link deriveActionDueDates} for the common "field value changed"
 * recalculation path.
 */
export function deriveSchedule(
	fields: readonly Field[],
	events: readonly Event[],
	actions: readonly Action[]
): { events: EventResolution[]; actions: ActionDueResolution[] } {
	const resolvedEvents = resolveEvents(fields, events);
	const resolvedActions = deriveActionDueDates(actions, resolvedEvents);
	return { events: resolvedEvents, actions: resolvedActions };
}
