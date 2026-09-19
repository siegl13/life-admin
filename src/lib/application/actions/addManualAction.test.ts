import { describe, expect, it, vi } from 'vitest';
import type { Action } from '../../domain/action/action';
import type { ActionRepositoryPort, CycleRepositoryPort } from '../ports';
import { ItemHasNoActiveCycleError } from '../items/updateItemFields';
import {
	addManualAction,
	InvalidManualDueDateError,
	ManualActionLabelRequiredError
} from './addManualAction';

const CYCLE = {
	id: 'cycle-1',
	itemId: 'item-1',
	sequence: 1,
	status: 'ACTIVE' as const,
	createdAt: 'x'
};

function ports(cycle: typeof CYCLE | null = CYCLE) {
	const cycles: CycleRepositoryPort = {
		getActiveCycle: vi.fn(() => cycle),
		listCycles: vi.fn(() => []),
		startNextCycle: vi.fn(() => {
			throw new Error('not used in this test');
		})
	};
	const actions: ActionRepositoryPort = {
		listActions: vi.fn(),
		listDependencies: vi.fn(),
		setActionState: vi.fn(),
		addManualAction: vi.fn((_cycleId, input) => ({ id: 'm1', ...input }) as unknown as Action),
		setActionDueOverride: vi.fn()
	};
	return { cycles, actions };
}

describe('addManualAction (application use case)', () => {
	it('rejects a blank label', () => {
		const p = ports();
		expect(() => addManualAction(p, { itemId: 'item-1', label: '  ' })).toThrow(
			ManualActionLabelRequiredError
		);
		expect(p.actions.addManualAction).not.toHaveBeenCalled();
	});

	it('rejects a malformed due date', () => {
		const p = ports();
		expect(() =>
			addManualAction(p, { itemId: 'item-1', label: 'Call the bank', dueDate: '31/12/2026' })
		).toThrow(InvalidManualDueDateError);
	});

	it('accepts no due date at all (manual actions may remain undated)', () => {
		const p = ports();
		addManualAction(p, { itemId: 'item-1', label: 'Call the bank' });
		expect(p.actions.addManualAction).toHaveBeenCalledWith(CYCLE.id, {
			label: 'Call the bank',
			dueDate: null
		});
	});

	it('accepts a valid ISO due date', () => {
		const p = ports();
		addManualAction(p, { itemId: 'item-1', label: 'Call the bank', dueDate: '2026-12-01' });
		expect(p.actions.addManualAction).toHaveBeenCalledWith(CYCLE.id, {
			label: 'Call the bank',
			dueDate: '2026-12-01'
		});
	});

	it('throws if the item has no active cycle', () => {
		const p = ports(null);
		expect(() => addManualAction(p, { itemId: 'item-1', label: 'X' })).toThrow(
			ItemHasNoActiveCycleError
		);
	});
});
