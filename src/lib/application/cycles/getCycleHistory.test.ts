import { describe, expect, it, vi } from 'vitest';
import type { Cycle } from '../../domain/cycle/cycle';
import type { ActionRepositoryPort, CycleRepositoryPort, FieldRepositoryPort } from '../ports';
import { getCycleHistory } from './getCycleHistory';

function cycle(overrides: Partial<Cycle>): Cycle {
	return {
		id: 'cycle-1',
		itemId: 'item-1',
		sequence: 1,
		status: 'COMPLETED',
		createdAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

describe('getCycleHistory', () => {
	it('returns only completed cycles, with their fields and actions', () => {
		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(),
			listCycles: vi.fn(() => [
				cycle({ id: 'cycle-2', sequence: 2, status: 'ACTIVE' }),
				cycle({ id: 'cycle-1', sequence: 1, status: 'COMPLETED' })
			]),
			startNextCycle: vi.fn()
		};
		const fields: FieldRepositoryPort = {
			listFields: vi.fn(() => []),
			addCustomField: vi.fn(),
			removeCustomField: vi.fn()
		};
		const actions: ActionRepositoryPort = {
			listActions: vi.fn(() => []),
			listDependencies: vi.fn(() => []),
			setActionState: vi.fn(),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn()
		};

		const history = getCycleHistory({ cycles, fields, actions }, 'item-1');

		expect(history).toHaveLength(1);
		expect(history[0].cycle.id).toBe('cycle-1');
		expect(fields.listFields).toHaveBeenCalledWith('cycle-1');
		expect(actions.listActions).toHaveBeenCalledWith('cycle-1');
	});

	it('returns an empty list for an item with only an active cycle', () => {
		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(),
			listCycles: vi.fn(() => [cycle({ status: 'ACTIVE' })]),
			startNextCycle: vi.fn()
		};
		const fields: FieldRepositoryPort = {
			listFields: vi.fn(() => []),
			addCustomField: vi.fn(),
			removeCustomField: vi.fn()
		};
		const actions: ActionRepositoryPort = {
			listActions: vi.fn(() => []),
			listDependencies: vi.fn(() => []),
			setActionState: vi.fn(),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn()
		};

		expect(getCycleHistory({ cycles, fields, actions }, 'item-1')).toEqual([]);
	});
});
