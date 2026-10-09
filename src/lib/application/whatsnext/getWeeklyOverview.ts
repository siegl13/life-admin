import { effectiveDueDate, hasResolvedDue } from '../../domain/action/action';
import { compareIsoDate, type IsoDate } from '../../domain/date/isoDate';
import { buildUpcoming } from '../../domain/upcoming/upcoming';
import type { WhatsNextItemInput } from '../../domain/whatsnext/whatsNext';

export interface WeeklyOverviewAction {
	itemId: string;
	itemTitle: string;
	actionId: string;
	label: string;
	dueDate: IsoDate;
}

export interface WeeklyOverview {
	rows: WeeklyOverviewAction[];
	remaining: number;
}

const MAX_ROWS = 5;

function compareWeeklyOverview(a: WeeklyOverviewAction, b: WeeklyOverviewAction): number {
	return (
		compareIsoDate(a.dueDate, b.dueDate) ||
		a.itemTitle.localeCompare(b.itemTitle) ||
		a.itemId.localeCompare(b.itemId) ||
		a.actionId.localeCompare(b.actionId)
	);
}

/** `buildUpcoming` is deliberately future-facing and excludes today, so this
 *  adds today's OPEN, resolved-due actions from the same working set it
 *  already read, then appends `buildUpcoming`'s unchanged `thisWeek` range. */
function projectDueToday(
	items: readonly WhatsNextItemInput[],
	todayIso: IsoDate
): WeeklyOverviewAction[] {
	const rows: WeeklyOverviewAction[] = [];
	for (const item of items) {
		for (const action of item.actions) {
			if (action.state !== 'OPEN' || !hasResolvedDue(action)) continue;
			const dueDate = effectiveDueDate(action);
			if (dueDate !== todayIso) continue;
			rows.push({
				itemId: item.itemId,
				itemTitle: item.title,
				actionId: action.actionId,
				label: action.label,
				dueDate
			});
		}
	}
	return rows;
}

/**
 * Projects the What's Next side panel's "This week" card: today through the
 * coming Sunday, open actions only, capped at five rows. Reuses
 * `buildUpcoming`'s existing `thisWeek` range rather than recalculating the
 * Sunday boundary.
 */
export function getWeeklyOverview(
	items: readonly WhatsNextItemInput[],
	todayIso: IsoDate
): WeeklyOverview {
	const dueToday = projectDueToday(items, todayIso);
	const thisWeek = buildUpcoming(items, todayIso).find((range) => range.key === 'thisWeek');
	const rest = (thisWeek?.actions ?? []).map((action) => ({
		itemId: action.itemId,
		itemTitle: action.itemTitle,
		actionId: action.actionId,
		label: action.label,
		dueDate: action.dueDate
	}));

	const allRows = [...dueToday, ...rest].sort(compareWeeklyOverview);
	return {
		rows: allRows.slice(0, MAX_ROWS),
		remaining: Math.max(0, allRows.length - MAX_ROWS)
	};
}
