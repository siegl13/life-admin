import type { Action } from '../../domain/action/action';
import type { Cycle } from '../../domain/cycle/cycle';
import type { Field } from '../../domain/field/field';
import type { ActionRepositoryPort, CycleRepositoryPort, FieldRepositoryPort } from '../ports';

export interface CycleHistoryEntry {
	cycle: Cycle;
	fields: Field[];
	actions: Action[];
}

/**
 * Every completed cycle of an item, newest first, with the fields and
 * actions it finished with. Read-only by construction: nothing here can
 * mutate a cycle, matching the "history is immutable" invariant.
 */
export function getCycleHistory(
	ports: {
		cycles: CycleRepositoryPort;
		fields: FieldRepositoryPort;
		actions: ActionRepositoryPort;
	},
	itemId: string
): CycleHistoryEntry[] {
	return ports.cycles
		.listCycles(itemId)
		.filter((cycle) => cycle.status === 'COMPLETED')
		.map((cycle) => ({
			cycle,
			fields: ports.fields.listFields(cycle.id),
			actions: ports.actions.listActions(cycle.id)
		}));
}
