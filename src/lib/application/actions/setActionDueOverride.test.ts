import { describe, expect, it, vi } from 'vitest';
import type { Action } from '../../domain/action/action';
import type { ActionRepositoryPort } from '../ports';
import { InvalidDueOverrideDateError, setActionDueOverride } from './setActionDueOverride';

function fakePorts(overrides: Partial<ActionRepositoryPort> = {}): {
	actions: ActionRepositoryPort;
} {
	return {
		actions: {
			listActions: vi.fn(),
			listDependencies: vi.fn(),
			setActionState: vi.fn(),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn(() => ({ id: 'a1' }) as Action),
			...overrides
		}
	};
}

describe('setActionDueOverride (application use case)', () => {
	it('delegates a valid override date to the repository', () => {
		const p = fakePorts();
		setActionDueOverride(p, { itemId: 'item-1', actionId: 'a1', dueDate: '2026-10-05' });
		expect(p.actions.setActionDueOverride).toHaveBeenCalledWith('item-1', 'a1', '2026-10-05');
	});

	it('treats an empty string the same as null (clears the override)', () => {
		const p = fakePorts();
		setActionDueOverride(p, { itemId: 'item-1', actionId: 'a1', dueDate: '' });
		expect(p.actions.setActionDueOverride).toHaveBeenCalledWith('item-1', 'a1', null);
	});

	it('passes null straight through (the reset action)', () => {
		const p = fakePorts();
		setActionDueOverride(p, { itemId: 'item-1', actionId: 'a1', dueDate: null });
		expect(p.actions.setActionDueOverride).toHaveBeenCalledWith('item-1', 'a1', null);
	});

	it('rejects a non-ISO date before calling the repository', () => {
		const p = fakePorts();
		expect(() =>
			setActionDueOverride(p, { itemId: 'item-1', actionId: 'a1', dueDate: '05/10/2026' })
		).toThrow(InvalidDueOverrideDateError);
		expect(p.actions.setActionDueOverride).not.toHaveBeenCalled();
	});

	it('lets a repository error (e.g. ActionNotMutableError) propagate', () => {
		const boom = new Error('not mutable');
		const p = fakePorts({
			setActionDueOverride: vi.fn(() => {
				throw boom;
			})
		});
		expect(() =>
			setActionDueOverride(p, { itemId: 'item-1', actionId: 'a1', dueDate: '2026-10-05' })
		).toThrow(boom);
	});
});
