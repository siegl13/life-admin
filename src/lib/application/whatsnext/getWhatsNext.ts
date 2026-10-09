import {
	buildWhatsNext,
	type WhatsNextAction,
	type WhatsNextActionInput,
	type WhatsNextGroup
} from '../../domain/whatsnext/whatsNext';
import type { IsoDate } from '../../domain/date/isoDate';
import type { WhatsNextItemInput } from '../../domain/whatsnext/whatsNext';
import type { Clock, WhatsNextRepositoryPort } from '../ports';

export interface WhatsNextDueEditability {
	state: WhatsNextActionInput['state'];
	dueKind: WhatsNextActionInput['dueKind'];
	suggestedDueDate: WhatsNextActionInput['dueDate'];
	dueOverrideDate: WhatsNextActionInput['dueOverrideDate'];
}

export interface WhatsNextActionView extends WhatsNextAction {
	dueEditability: WhatsNextDueEditability;
}

export interface WhatsNextGroupView extends Omit<WhatsNextGroup, 'actions'> {
	actions: WhatsNextActionView[];
}

/**
 * The primary product screen: "what do I need to do next, and when?".
 * All ranking/grouping/availability logic lives in the pure domain
 * function (domain/whatsnext/whatsNext.ts) — this use case only loads
 * the working set and today's date.
 */
export function getWhatsNext(
	ports: {
		whatsNext: WhatsNextRepositoryPort;
		clock: Clock;
	},
	loadedItems?: readonly WhatsNextItemInput[],
	todayIso: IsoDate = ports.clock.todayIso()
): WhatsNextGroupView[] {
	const items = loadedItems ?? ports.whatsNext.loadItems();
	const dueEditabilityByActionId = new Map<string, WhatsNextDueEditability>();
	for (const item of items) {
		for (const action of item.actions) {
			dueEditabilityByActionId.set(action.actionId, {
				state: action.state,
				dueKind: action.dueKind,
				suggestedDueDate: action.dueDate,
				dueOverrideDate: action.dueOverrideDate
			});
		}
	}

	return buildWhatsNext(items, todayIso).map((group) => ({
		...group,
		actions: group.actions.map((action) => {
			const dueEditability = dueEditabilityByActionId.get(action.actionId);
			if (!dueEditability) throw new Error("What's next action input is missing");
			return { ...action, dueEditability };
		})
	}));
}
