import { effectiveDueDate } from '../action/action';
import { hasResolvedDue } from '../action/action';
import { isAvailable } from '../action/dependencies';
import { applyOffset, compareIsoDate, parseIsoDate, type IsoDate } from '../date/isoDate';
import type { WhatsNextActionInput, WhatsNextItemInput } from '../whatsnext/whatsNext';

export type UpcomingRangeKey = 'thisWeek' | 'next30Days' | 'later';

export interface UpcomingAction {
	itemId: string;
	itemTitle: string;
	actionId: string;
	label: string;
	dueDate: IsoDate;
	available: boolean;
}

export interface UpcomingRange {
	key: UpcomingRangeKey;
	actions: UpcomingAction[];
}

function comingSunday(todayIso: IsoDate): IsoDate {
	const dayOfWeek = parseIsoDate(todayIso).getDay();
	return applyOffset(todayIso, { days: (7 - dayOfWeek) % 7 });
}

function rangeFor(dueDate: IsoDate, todayIso: IsoDate): UpcomingRangeKey {
	const sunday = comingSunday(todayIso);
	const thirtyDaysFromToday = applyOffset(todayIso, { days: 30 });
	if (compareIsoDate(dueDate, sunday) <= 0) return 'thisWeek';
	if (compareIsoDate(dueDate, thirtyDaysFromToday) <= 0) return 'next30Days';
	return 'later';
}

function compareActions(a: UpcomingAction, b: UpcomingAction): number {
	return (
		compareIsoDate(a.dueDate, b.dueDate) ||
		a.itemTitle.localeCompare(b.itemTitle) ||
		a.itemId.localeCompare(b.itemId) ||
		a.actionId.localeCompare(b.actionId)
	);
}

function projectAction(
	item: WhatsNextItemInput,
	action: WhatsNextActionInput
): UpcomingAction | null {
	if (action.state !== 'OPEN' || !hasResolvedDue(action)) return null;
	const dueDate = effectiveDueDate(action);
	if (!dueDate) return null;
	return {
		itemId: item.itemId,
		itemTitle: item.title,
		actionId: action.actionId,
		label: action.label,
		dueDate,
		available: isAvailable(action, action.dependencyStates)
	};
}

/**
 * Projects future, dated work from the existing active working set. This does
 * not rank or mutate actions, and it deliberately keeps blocked actions so the
 * user can see what depends on earlier work.
 */
export function buildUpcoming(
	items: readonly WhatsNextItemInput[],
	todayIso: IsoDate
): UpcomingRange[] {
	const ranges: Record<UpcomingRangeKey, UpcomingAction[]> = {
		thisWeek: [],
		next30Days: [],
		later: []
	};

	for (const item of items) {
		for (const action of item.actions) {
			const projected = projectAction(item, action);
			if (!projected || compareIsoDate(projected.dueDate, todayIso) <= 0) continue;
			ranges[rangeFor(projected.dueDate, todayIso)].push(projected);
		}
	}

	return (Object.keys(ranges) as UpcomingRangeKey[]).map((key) => ({
		key,
		actions: ranges[key].sort(compareActions)
	}));
}
