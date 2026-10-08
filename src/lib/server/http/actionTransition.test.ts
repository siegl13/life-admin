import { describe, expect, it, vi } from 'vitest';
import {
	ActionNotMutableError,
	applyActionTransition,
	applyGuardedDueOverride,
	parseDueOverrideFormData,
	parseTransitionFormData
} from './actionTransition';
import { InvalidDueOverrideDateError } from '$lib/application/actions/setActionDueOverride';
import { setLocaleProvider } from '$lib/i18n';
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

describe('applyGuardedDueOverride', () => {
	function dueOverridePorts(impl: (...args: unknown[]) => Action) {
		return {
			actions: {
				listActions: vi.fn(),
				listDependencies: vi.fn(),
				setActionState: vi.fn(),
				addManualAction: vi.fn(),
				setActionDueOverride: vi.fn(impl)
			},
			history: {
				insert: vi.fn(),
				listByItem: vi.fn(),
				countByItem: vi.fn(),
				deleteForItem: vi.fn()
			},
			ids: { newId: () => 'history-1' },
			clock: {
				nowIso: () => '2026-01-01T00:00:00.000Z',
				todayIso: () => '2026-01-01',
				localHour: () => 9
			}
		};
	}

	it('sets the override and records the caller-chosen event type on success', () => {
		const action = { id: 'a1', dueOverrideDate: '2026-02-01' } as Action;
		const p = dueOverridePorts(() => action);

		const result = applyGuardedDueOverride(
			p,
			{ itemId: 'item-1', actionId: 'a1', dueDate: '2026-02-01' },
			'ACTION_DUE_OVERRIDE_SET',
			'not mutable',
			() => true
		);

		expect(result).toBe(action);
		expect(p.actions.setActionDueOverride).toHaveBeenCalledWith('item-1', 'a1', '2026-02-01');
		expect(p.history.insert).toHaveBeenCalledWith(
			expect.objectContaining({ itemId: 'item-1', eventType: 'ACTION_DUE_OVERRIDE_SET' })
		);
	});

	it('records CLEARED when the caller is resetting the override', () => {
		const action = { id: 'a1', dueOverrideDate: null } as Action;
		const p = dueOverridePorts(() => action);

		applyGuardedDueOverride(
			p,
			{ itemId: 'item-1', actionId: 'a1', dueDate: null },
			'ACTION_DUE_OVERRIDE_CLEARED',
			'not mutable',
			() => true
		);

		expect(p.history.insert).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'ACTION_DUE_OVERRIDE_CLEARED' })
		);
	});

	it('maps an invalid date to a 400 that preserves the actionId and submitted value, without recording history', () => {
		const p = dueOverridePorts(() => {
			throw new InvalidDueOverrideDateError('not-a-date');
		});

		const result = applyGuardedDueOverride(
			p,
			{ itemId: 'item-1', actionId: 'a1', dueDate: 'not-a-date' },
			'ACTION_DUE_OVERRIDE_SET',
			'not mutable',
			() => true
		);

		expect(result).toMatchObject({
			status: 400,
			data: { context: 'dueOverride', actionId: 'a1', dueDate: 'not-a-date' }
		});
		expect(p.history.insert).not.toHaveBeenCalled();
	});

	it('maps an invalid date to a catalog-translated message, in German and English, never the raw exception text', () => {
		try {
			setLocaleProvider(() => 'de');
			const de = applyGuardedDueOverride(
				dueOverridePorts(() => {
					throw new InvalidDueOverrideDateError('not-a-date');
				}),
				{ itemId: 'item-1', actionId: 'a1', dueDate: 'not-a-date' },
				'ACTION_DUE_OVERRIDE_SET',
				'not mutable',
				() => true
			);
			expect(de).toMatchObject({ data: { error: 'Bitte ein gültiges Datum eingeben.' } });

			setLocaleProvider(() => 'en');
			const en = applyGuardedDueOverride(
				dueOverridePorts(() => {
					throw new InvalidDueOverrideDateError('not-a-date');
				}),
				{ itemId: 'item-1', actionId: 'a1', dueDate: 'not-a-date' },
				'ACTION_DUE_OVERRIDE_SET',
				'not mutable',
				() => true
			);
			expect(en).toMatchObject({ data: { error: 'Please enter a valid date.' } });
		} finally {
			setLocaleProvider(() => 'de');
		}
	});

	it('maps a stale/non-mutable action to the caller-provided message, without recording history', () => {
		const p = dueOverridePorts(() => {
			throw new ActionNotMutableError();
		});

		const result = applyGuardedDueOverride(
			p,
			{ itemId: 'item-1', actionId: 'a1', dueDate: '2026-02-01' },
			'ACTION_DUE_OVERRIDE_SET',
			'not mutable',
			() => true
		);

		expect(result).toMatchObject({
			status: 400,
			data: { error: 'not mutable', context: 'dueOverride', actionId: 'a1' }
		});
		expect(p.history.insert).not.toHaveBeenCalled();
	});

	it('propagates an unexpected failure instead of swallowing it', () => {
		const p = dueOverridePorts(() => {
			throw new Error('db down');
		});

		expect(() =>
			applyGuardedDueOverride(
				p,
				{ itemId: 'item-1', actionId: 'a1', dueDate: '2026-02-01' },
				'ACTION_DUE_OVERRIDE_SET',
				'not mutable',
				() => true
			)
		).toThrow('db down');
		expect(p.history.insert).not.toHaveBeenCalled();
	});

	it('rejects an action that is no longer eligible before writing or recording history', () => {
		const p = dueOverridePorts(() => ({ id: 'a1' }) as Action);

		const result = applyGuardedDueOverride(
			p,
			{ itemId: 'item-1', actionId: 'a1', dueDate: '2026-02-01' },
			'ACTION_DUE_OVERRIDE_SET',
			'not mutable',
			() => false
		);

		expect(result).toMatchObject({
			status: 400,
			data: { error: 'not mutable', context: 'dueOverride', actionId: 'a1' }
		});
		expect(p.actions.setActionDueOverride).not.toHaveBeenCalled();
		expect(p.history.insert).not.toHaveBeenCalled();
	});
});

describe('parseDueOverrideFormData', () => {
	function form(entries: Record<string, string>): FormData {
		const fd = new FormData();
		for (const [k, v] of Object.entries(entries)) fd.set(k, v);
		return fd;
	}

	it('requires actionId always, and itemId only when asked for', () => {
		expect(parseDueOverrideFormData(form({}), { requireItemId: false })).toBeNull();
		expect(
			parseDueOverrideFormData(form({ actionId: 'a1', dueDate: '2026-02-01' }), {
				requireItemId: false
			})
		).toEqual({ itemId: '', actionId: 'a1', dueDate: '2026-02-01' });
		expect(parseDueOverrideFormData(form({ actionId: 'a1' }), { requireItemId: true })).toBeNull();
		expect(
			parseDueOverrideFormData(form({ actionId: 'a1', itemId: 'i1' }), { requireItemId: true })
		).toEqual({ itemId: 'i1', actionId: 'a1', dueDate: null });
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
