import { compareIsoDate, isBeforeToday, type IsoDate } from '../date/isoDate';
import { isAvailable } from '../action/dependencies';
import { effectiveDueDate } from '../action/action';
import type { Action } from '../action/action';

/**
 * The one screen that answers "what do I need to do next, and when?".
 * This module is pure and knows nothing about SQL, HTTP, or Svelte: it
 * ranks and groups an already-loaded in-memory working set. The
 * repository (server/db/repositories/whatsNextRepository.ts) is
 * responsible for loading only ACTIVE items / ACTIVE cycles / OPEN
 * actions with resolved dependency states before calling this.
 */

export interface WhatsNextActionInput {
	actionId: string;
	label: string;
	state: Action['state'];
	dueKind: Action['dueKind'];
	dueDate: IsoDate | null;
	dueOverrideDate: IsoDate | null;
	position: number;
	/** States of every action this one depends on. */
	dependencyStates: readonly Action['state'][];
}

export interface WhatsNextItemInput {
	itemId: string;
	title: string;
	actions: readonly WhatsNextActionInput[];
}

/** 0 = overdue, 1 = ready but undated, 2 = due in the future. */
export type WhatsNextBucket = 0 | 1 | 2;

export interface WhatsNextAction {
	actionId: string;
	label: string;
	dueDate: IsoDate | null;
	bucket: WhatsNextBucket;
}

export interface WhatsNextGroup {
	itemId: string;
	title: string;
	actions: WhatsNextAction[];
}

function bucketOf(dueDate: IsoDate | null, todayIso: IsoDate): WhatsNextBucket {
	if (dueDate !== null) {
		return isBeforeToday(dueDate, todayIso) ? 0 : 2;
	}
	// No date: either NONE or an undated MANUAL action, both "ready now".
	return 1;
}

/**
 * Builds the What's Next working set: available actions, grouped by their
 * Item, ranked overdue-first, then ready-undated, then future-dated. An
 * item with no available actions is omitted entirely. Never flattens
 * actions into an anonymous list — the item is always the group.
 */
export function buildWhatsNext(
	items: readonly WhatsNextItemInput[],
	todayIso: IsoDate
): WhatsNextGroup[] {
	const groups: WhatsNextGroup[] = [];

	for (const item of items) {
		const available = item.actions.filter((action) =>
			isAvailable(
				{ state: action.state, dueKind: action.dueKind, dueDate: action.dueDate },
				action.dependencyStates
			)
		);
		if (available.length === 0) continue;

		// Ranking/overdue-bucketing reasons about the EFFECTIVE due date (the
		// user's override when set, otherwise the calculated date) — the one
		// place this precedence rule is applied for What's Next. Availability
		// above is deliberately still based on the raw calculated date via
		// `isAvailable`: an override changes what date is shown and how an
		// action sorts, never whether it is unlocked yet.
		const ranked = available
			.map((action) => {
				const dueDate = effectiveDueDate(action);
				return { action, dueDate, bucket: bucketOf(dueDate, todayIso) };
			})
			.sort((a, b) => {
				if (a.bucket !== b.bucket) return a.bucket - b.bucket;
				if (a.dueDate !== b.dueDate) {
					if (a.dueDate === null) return 1;
					if (b.dueDate === null) return -1;
					return compareIsoDate(a.dueDate, b.dueDate);
				}
				return a.action.position - b.action.position;
			})
			.map(({ action, dueDate, bucket }) => ({
				actionId: action.actionId,
				label: action.label,
				dueDate,
				bucket
			}));

		groups.push({ itemId: item.itemId, title: item.title, actions: ranked });
	}

	return groups.sort((a, b) => {
		const aMin = Math.min(...a.actions.map((x) => x.bucket));
		const bMin = Math.min(...b.actions.map((x) => x.bucket));
		if (aMin !== bMin) return aMin - bMin;

		const aDate = a.actions.find((x) => x.dueDate !== null)?.dueDate ?? null;
		const bDate = b.actions.find((x) => x.dueDate !== null)?.dueDate ?? null;
		if (aDate !== bDate) {
			if (aDate === null) return 1;
			if (bDate === null) return -1;
			return compareIsoDate(aDate, bDate);
		}

		return a.title.localeCompare(b.title);
	});
}
