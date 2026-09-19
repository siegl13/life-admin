import { describe, expect, it, vi } from 'vitest';
import type { Action } from '../../domain/action/action';
import type { ActionRepositoryPort } from '../ports';
import { setActionState } from './setActionState';

describe('setActionState (application use case)', () => {
	it('delegates the transition to the action repository', () => {
		const resultAction = { id: 'a1', state: 'DONE' } as Action;
		const actions: ActionRepositoryPort = {
			listActions: vi.fn(),
			listDependencies: vi.fn(),
			setActionState: vi.fn(() => resultAction),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn()
		};

		const result = setActionState(
			{ actions },
			{ itemId: 'item-1', actionId: 'a1', newState: 'DONE' }
		);

		expect(actions.setActionState).toHaveBeenCalledWith('item-1', 'a1', 'DONE');
		expect(result).toBe(resultAction);
	});

	it('lets a repository transition error (e.g. reopening) propagate', () => {
		const boom = new Error('invalid transition');
		const actions: ActionRepositoryPort = {
			listActions: vi.fn(),
			listDependencies: vi.fn(),
			setActionState: vi.fn(() => {
				throw boom;
			}),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn()
		};

		expect(() =>
			setActionState({ actions }, { itemId: 'item-1', actionId: 'a1', newState: 'DONE' })
		).toThrow(boom);
	});
});
