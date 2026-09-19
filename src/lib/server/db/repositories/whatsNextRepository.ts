import type Database from 'better-sqlite3';
import type { WhatsNextItemInput } from '$lib/domain/whatsnext/whatsNext';
import { listActions, listDependencies } from './actionRepository';
import { getActiveCycle } from './cycleRepository';
import { listItems } from './itemRepository';

/**
 * Loads the full working set for the What's Next screen: every ACTIVE
 * item's ACTIVE cycle, its actions, and each action's dependency states
 * — everything domain/whatsnext/whatsNext.ts needs to rank and group,
 * with no ranking/availability logic living here. Dataset sizes for a
 * self-hosted single-household app are small (a handful of items), so
 * this composes already-tested per-cycle queries rather than one large
 * hand-optimized join.
 */
export function loadWhatsNextItems(db: Database.Database): WhatsNextItemInput[] {
	const items = listItems(db, 'ACTIVE');
	const result: WhatsNextItemInput[] = [];

	for (const item of items) {
		const cycle = getActiveCycle(db, item.id);
		if (!cycle) continue; // should not happen: every item gets one ACTIVE cycle at creation

		const actions = listActions(db, cycle.id);
		const dependencies = listDependencies(db, cycle.id);
		const stateById = new Map(actions.map((a) => [a.id, a.state]));

		const openActions = actions.filter((a) => a.state === 'OPEN');
		if (openActions.length === 0) continue;

		result.push({
			itemId: item.id,
			title: item.title,
			actions: openActions.map((action) => ({
				actionId: action.id,
				label: action.label,
				state: action.state,
				dueKind: action.dueKind,
				dueDate: action.dueDate,
				dueOverrideDate: action.dueOverrideDate,
				position: action.position,
				dependencyStates: dependencies
					.filter((d) => d.actionId === action.id)
					.map((d) => stateById.get(d.dependsOnActionId))
					.filter((s): s is NonNullable<typeof s> => s !== undefined)
			}))
		});
	}

	return result;
}
