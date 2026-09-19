import { describe, expect, it, vi } from 'vitest';
import type { Action, ActionDependency } from '../../domain/action/action';
import type { Event } from '../../domain/event/event';
import type { Field } from '../../domain/field/field';
import type {
	ActionRepositoryPort,
	CycleRepositoryPort,
	EventRepositoryPort,
	FieldRepositoryPort
} from '../ports';
import { getItemWorkflow } from './getItemWorkflow';

const CYCLE = {
	id: 'cycle-1',
	itemId: 'item-1',
	sequence: 1,
	status: 'ACTIVE' as const,
	createdAt: 'x'
};

function action(overrides: Partial<Action>): Action {
	return {
		id: 'a1',
		cycleId: CYCLE.id,
		actionKey: 'a',
		label: 'A',
		description: null,
		state: 'OPEN',
		position: 0,
		createdAt: 'x',
		completedAt: null,
		dueKind: 'NONE',
		dueDate: null,
		...overrides
	} as Action;
}

function event(overrides: Partial<Event>): Event {
	return {
		id: 'e1',
		cycleId: CYCLE.id,
		eventKey: 'e',
		label: 'Event',
		sourceFieldKey: 'f',
		resolvedDate: null,
		position: 0,
		...overrides
	};
}

function field(overrides: Partial<Field>): Field {
	return {
		id: 'f1',
		cycleId: CYCLE.id,
		fieldKey: 'f',
		label: 'Field',
		type: 'date',
		origin: 'PLAYBOOK',
		recommended: false,
		position: 0,
		value: null,
		...overrides
	} as Field;
}

const noEvents: EventRepositoryPort = { listEvents: vi.fn(() => []) };
const noFields: FieldRepositoryPort = {
	listFields: vi.fn(() => []),
	addCustomField: vi.fn(),
	removeCustomField: vi.fn()
};

describe('getItemWorkflow', () => {
	it('returns null when the item has no active cycle', () => {
		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(() => null),
			listCycles: vi.fn(() => []),
			startNextCycle: vi.fn(() => {
				throw new Error('not used in this test');
			})
		};
		const actions: ActionRepositoryPort = {
			listActions: vi.fn(),
			listDependencies: vi.fn(),
			setActionState: vi.fn(),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn()
		};
		expect(
			getItemWorkflow({ cycles, actions, events: noEvents, fields: noFields }, 'item-1')
		).toBeNull();
	});

	it('marks an action blocked while its dependency is still OPEN', () => {
		const dep = action({ id: 'a1', actionKey: 'first' });
		const gated = action({ id: 'a2', actionKey: 'second' });
		const deps: ActionDependency[] = [{ actionId: 'a2', dependsOnActionId: 'a1' }];

		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(() => CYCLE),
			listCycles: vi.fn(() => []),
			startNextCycle: vi.fn(() => {
				throw new Error('not used in this test');
			})
		};
		const actions: ActionRepositoryPort = {
			listActions: vi.fn(() => [dep, gated]),
			listDependencies: vi.fn(() => deps),
			setActionState: vi.fn(),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn()
		};

		const workflow = getItemWorkflow(
			{ cycles, actions, events: noEvents, fields: noFields },
			'item-1'
		)!;
		expect(workflow.find((w) => w.action.id === 'a1')!.available).toBe(true);
		expect(workflow.find((w) => w.action.id === 'a2')!.available).toBe(false);
	});

	it('marks the following action available once its dependency is DONE', () => {
		const dep = action({ id: 'a1', actionKey: 'first', state: 'DONE', completedAt: 'x' });
		const gated = action({ id: 'a2', actionKey: 'second' });
		const deps: ActionDependency[] = [{ actionId: 'a2', dependsOnActionId: 'a1' }];

		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(() => CYCLE),
			listCycles: vi.fn(() => []),
			startNextCycle: vi.fn(() => {
				throw new Error('not used in this test');
			})
		};
		const actions: ActionRepositoryPort = {
			listActions: vi.fn(() => [dep, gated]),
			listDependencies: vi.fn(() => deps),
			setActionState: vi.fn(),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn()
		};

		const workflow = getItemWorkflow(
			{ cycles, actions, events: noEvents, fields: noFields },
			'item-1'
		)!;
		expect(workflow.find((w) => w.action.id === 'a2')!.available).toBe(true);
	});

	it('marks an unresolved DERIVED action as unavailable', () => {
		const derived = action({
			id: 'a1',
			dueKind: 'DERIVED',
			dueEventKey: 'e',
			dueOffset: {},
			dueDate: null
		} as Partial<Action>);

		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(() => CYCLE),
			listCycles: vi.fn(() => []),
			startNextCycle: vi.fn(() => {
				throw new Error('not used in this test');
			})
		};
		const actions: ActionRepositoryPort = {
			listActions: vi.fn(() => [derived]),
			listDependencies: vi.fn(() => []),
			setActionState: vi.fn(),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn()
		};

		const workflow = getItemWorkflow(
			{ cycles, actions, events: noEvents, fields: noFields },
			'item-1'
		)!;
		expect(workflow[0].available).toBe(false);
	});

	it('marks a MANUAL action available immediately, with or without a due date', () => {
		const undated = action({ id: 'a1', actionKey: 'm_1', dueKind: 'MANUAL', dueDate: null });
		const dated = action({ id: 'a2', actionKey: 'm_2', dueKind: 'MANUAL', dueDate: '2026-05-01' });

		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(() => CYCLE),
			listCycles: vi.fn(() => []),
			startNextCycle: vi.fn(() => {
				throw new Error('not used in this test');
			})
		};
		const actions: ActionRepositoryPort = {
			listActions: vi.fn(() => [undated, dated]),
			listDependencies: vi.fn(() => []),
			setActionState: vi.fn(),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn()
		};

		const workflow = getItemWorkflow(
			{ cycles, actions, events: noEvents, fields: noFields },
			'item-1'
		)!;
		expect(workflow.find((w) => w.action.id === 'a1')!.available).toBe(true);
		expect(workflow.find((w) => w.action.id === 'a2')!.available).toBe(true);
	});

	it('marks a DONE or SKIPPED action as unavailable (it is history, not current work)', () => {
		const done = action({ id: 'a1', state: 'DONE', completedAt: 'x' });
		const skipped = action({ id: 'a2', state: 'SKIPPED', completedAt: 'x' });

		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(() => CYCLE),
			listCycles: vi.fn(() => []),
			startNextCycle: vi.fn(() => {
				throw new Error('not used in this test');
			})
		};
		const actions: ActionRepositoryPort = {
			listActions: vi.fn(() => [done, skipped]),
			listDependencies: vi.fn(() => []),
			setActionState: vi.fn(),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn()
		};

		const workflow = getItemWorkflow(
			{ cycles, actions, events: noEvents, fields: noFields },
			'item-1'
		)!;
		expect(workflow.find((w) => w.action.id === 'a1')!.available).toBe(false);
		expect(workflow.find((w) => w.action.id === 'a2')!.available).toBe(false);
	});

	it('gives an unresolved DERIVED action an "unresolvedDate" blocked reason naming its source field, not the event', () => {
		const derived = action({
			id: 'a1',
			dueKind: 'DERIVED',
			dueEventKey: 'contract_ends',
			dueOffset: {},
			dueDate: null
		} as Partial<Action>);

		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(() => CYCLE),
			listCycles: vi.fn(() => []),
			startNextCycle: vi.fn(() => {
				throw new Error('not used in this test');
			})
		};
		const actions: ActionRepositoryPort = {
			listActions: vi.fn(() => [derived]),
			listDependencies: vi.fn(() => []),
			setActionState: vi.fn(),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn()
		};
		const events: EventRepositoryPort = {
			listEvents: vi.fn(() => [
				event({ eventKey: 'contract_ends', label: 'Vertrag endet', sourceFieldKey: 'contract_end' })
			])
		};
		const fields: FieldRepositoryPort = {
			listFields: vi.fn(() => [field({ fieldKey: 'contract_end', label: 'Vertragsende' })]),
			addCustomField: vi.fn(),
			removeCustomField: vi.fn()
		};

		const workflow = getItemWorkflow({ cycles, actions, events, fields }, 'item-1')!;
		expect(workflow[0].blockedReason).toEqual({
			kind: 'unresolvedDate',
			fieldLabel: 'Vertragsende'
		});
	});

	it('gives an action blocked by a real dependency a "dependency" blocked reason naming the blocking action', () => {
		const dep = action({ id: 'a1', actionKey: 'first', label: 'Eingang prüfen' });
		const gated = action({ id: 'a2', actionKey: 'second', label: 'Weiterleiten' });
		const deps: ActionDependency[] = [{ actionId: 'a2', dependsOnActionId: 'a1' }];

		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(() => CYCLE),
			listCycles: vi.fn(() => []),
			startNextCycle: vi.fn(() => {
				throw new Error('not used in this test');
			})
		};
		const actions: ActionRepositoryPort = {
			listActions: vi.fn(() => [dep, gated]),
			listDependencies: vi.fn(() => deps),
			setActionState: vi.fn(),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn()
		};

		const workflow = getItemWorkflow(
			{ cycles, actions, events: noEvents, fields: noFields },
			'item-1'
		)!;
		expect(workflow.find((w) => w.action.id === 'a2')!.blockedReason).toEqual({
			kind: 'dependency',
			blockingLabels: ['Eingang prüfen']
		});
	});

	it('never sets a blocked reason for an action that is already available, done or skipped', () => {
		const available = action({ id: 'a1', actionKey: 'a1' });
		const done = action({ id: 'a2', actionKey: 'a2', state: 'DONE', completedAt: 'x' });

		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(() => CYCLE),
			listCycles: vi.fn(() => []),
			startNextCycle: vi.fn(() => {
				throw new Error('not used in this test');
			})
		};
		const actions: ActionRepositoryPort = {
			listActions: vi.fn(() => [available, done]),
			listDependencies: vi.fn(() => []),
			setActionState: vi.fn(),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn()
		};

		const workflow = getItemWorkflow(
			{ cycles, actions, events: noEvents, fields: noFields },
			'item-1'
		)!;
		expect(workflow.find((w) => w.action.id === 'a1')!.blockedReason).toBeNull();
		expect(workflow.find((w) => w.action.id === 'a2')!.blockedReason).toBeNull();
	});
});
