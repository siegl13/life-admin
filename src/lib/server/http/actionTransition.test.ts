import { describe, expect, it, vi } from 'vitest';
import {
	ActionNotMutableError,
	applyActionTransition,
	parseTransitionFormData
} from './actionTransition';
import type { Action } from '$lib/domain/action/action';

function ports(setActionStateImpl: (...args: unknown[]) => Action) {
	return {
		actions: {
			listActions: vi.fn(),
			listDependencies: vi.fn(),
			setActionState: vi.fn(setActionStateImpl),
			addManualAction: vi.fn(),
			setActionDueOverride: vi.fn()
		},
		history: { insert: vi.fn(), listByItem: vi.fn(), countByItem: vi.fn(), deleteForItem: vi.fn() },
		ids: { newId: () => 'history-1' },
		clock: {
			nowIso: () => '2026-01-01T00:00:00.000Z',
			todayIso: () => '2026-01-01',
			localHour: () => 9
		}
	};
}

describe('applyActionTransition', () => {
	it('transitions the action and records one matching history event on success', () => {
		const action = { id: 'a1', label: 'Pay invoice' } as Action;
		const p = ports(() => action);

		const result = applyActionTransition(p, { itemId: 'item-1', actionId: 'a1', newState: 'DONE' });

		expect(result).toBe(action);
		expect(p.actions.setActionState).toHaveBeenCalledWith('item-1', 'a1', 'DONE');
		expect(p.history.insert).toHaveBeenCalledTimes(1);
		expect(p.history.insert).toHaveBeenCalledWith(
			expect.objectContaining({ itemId: 'item-1', eventType: 'ACTION_COMPLETED' })
		);
	});

	it('maps SKIPPED and OPEN to their own history event types', () => {
		const p1 = ports(() => ({ id: 'a1', label: 'x' }) as Action);
		applyActionTransition(p1, { itemId: 'i', actionId: 'a1', newState: 'SKIPPED' });
		expect(p1.history.insert).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'ACTION_SKIPPED' })
		);

		const p2 = ports(() => ({ id: 'a1', label: 'x' }) as Action);
		applyActionTransition(p2, { itemId: 'i', actionId: 'a1', newState: 'OPEN' });
		expect(p2.history.insert).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'ACTION_REOPENED' })
		);
	});

	it('records no history event when the repository rejects the transition', () => {
		const p = ports(() => {
			throw new ActionNotMutableError();
		});

		expect(() =>
			applyActionTransition(p, { itemId: 'item-1', actionId: 'a1', newState: 'DONE' })
		).toThrow(ActionNotMutableError);
		expect(p.history.insert).not.toHaveBeenCalled();
	});

	it('propagates an unexpected failure instead of swallowing it', () => {
		const p = ports(() => {
			throw new Error('db down');
		});

		expect(() =>
			applyActionTransition(p, { itemId: 'item-1', actionId: 'a1', newState: 'DONE' })
		).toThrow('db down');
		expect(p.history.insert).not.toHaveBeenCalled();
	});

	it('propagates a history failure that happens AFTER the state write already succeeded, instead of hiding it', () => {
		const action = { id: 'a1', label: 'x' } as Action;
		const p = ports(() => action);
		p.history.insert.mockImplementation(() => {
			throw new Error('history db down');
		});

		expect(() =>
			applyActionTransition(p, { itemId: 'item-1', actionId: 'a1', newState: 'DONE' })
		).toThrow('history db down');
		// The durable state change already happened — a history failure must
		// surface loudly, never silently roll back or mask a committed write.
		expect(p.actions.setActionState).toHaveBeenCalledWith('item-1', 'a1', 'DONE');
	});
});

describe('parseTransitionFormData', () => {
	function form(entries: Record<string, string>): FormData {
		const fd = new FormData();
		for (const [k, v] of Object.entries(entries)) fd.set(k, v);
		return fd;
	}

	it('requires actionId always, and itemId only when asked for', () => {
		expect(parseTransitionFormData(form({}), { requireItemId: false })).toBeNull();
		expect(parseTransitionFormData(form({ actionId: 'a1' }), { requireItemId: false })).toEqual({
			itemId: '',
			actionId: 'a1'
		});
		expect(parseTransitionFormData(form({ actionId: 'a1' }), { requireItemId: true })).toBeNull();
		expect(
			parseTransitionFormData(form({ actionId: 'a1', itemId: 'i1' }), { requireItemId: true })
		).toEqual({ itemId: 'i1', actionId: 'a1' });
	});
});
