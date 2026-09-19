import { isCycleComplete } from '../../domain/cycle/completion';
import { planNextCycleFields } from '../../domain/cycle/rollover';
import { materializePlaybook } from '../../domain/playbook/materialize';
import {
	parsePlaybookSnapshot,
	type SnapshotValidationIssue
} from '../../domain/playbook/snapshot';
import type { Cycle } from '../../domain/cycle/cycle';
import type {
	ActionRepositoryPort,
	CycleRepositoryPort,
	FieldRepositoryPort,
	ItemRepositoryPort
} from '../ports';
import { ItemHasNoActiveCycleError } from '../items/updateItemFields';
import { resolvePlanLocale } from '../playbooks/resolvePlanLocale';

export class ItemIsArchivedError extends Error {}
export class CycleNotCompleteError extends Error {}
export class ItemHasNoPlaybookError extends Error {}
export class InvalidPlaybookSnapshotError extends Error {
	constructor(readonly issues: SnapshotValidationIssue[]) {
		super('Invalid playbook snapshot');
	}
}

/**
 * Completes an item's active cycle and starts the next one, built from
 * the item's frozen `playbookSnapshot` — never from the current YAML on
 * disk (see docs/adr/0004's Slice 8 amendment). This use case
 * deliberately has no dependency on `PlaybookCatalogPort`: "never reads
 * the current YAML" is a compile-time fact here, not a promise.
 *
 * The completion rule is checked here, not only in the UI, so a
 * hand-crafted POST against an item with an OPEN action cannot bypass it
 * (see docs/adr, the new cycles ADR).
 */
export function startNextCycle(
	ports: {
		items: ItemRepositoryPort;
		cycles: CycleRepositoryPort;
		fields: FieldRepositoryPort;
		actions: ActionRepositoryPort;
	},
	input: { itemId: string }
): Cycle {
	const item = ports.items.getItemById(input.itemId);
	if (!item) throw new ItemHasNoActiveCycleError(input.itemId);
	if (item.status !== 'ACTIVE') throw new ItemIsArchivedError();

	const cycle = ports.cycles.getActiveCycle(input.itemId);
	if (!cycle) throw new ItemHasNoActiveCycleError(input.itemId);

	if (!isCycleComplete(ports.actions.listActions(cycle.id))) {
		throw new CycleNotCompleteError();
	}

	// Checked before the "no playbook" case: a corrupted snapshot and "this
	// item never had a playbook" both leave playbookSnapshot === null, but
	// they are different situations and must not collapse into the wrong
	// user-facing message (see the Slice 8 review, finding 3).
	if (item.playbookSnapshotCorrupted) {
		throw new InvalidPlaybookSnapshotError([{ path: ['(malformed snapshot JSON)'] }]);
	}
	if (item.playbookSnapshot === null) throw new ItemHasNoPlaybookError();

	const parsed = parsePlaybookSnapshot(item.playbookSnapshot);
	if (!parsed.ok) throw new InvalidPlaybookSnapshotError(parsed.issues);

	const plan = resolvePlanLocale(materializePlaybook(parsed.playbook));
	const previousFields = ports.fields.listFields(cycle.id);
	const fields = planNextCycleFields(plan, previousFields);

	return ports.cycles.startNextCycle({
		itemId: input.itemId,
		completingCycleId: cycle.id,
		playbookVersion: parsed.playbook.version,
		fields,
		events: plan.events,
		actions: plan.actions
	});
}
