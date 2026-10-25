import { describe, expect, it, vi } from 'vitest';
import type { CycleRepositoryPort, FieldRepositoryPort } from '../ports';
import { setFieldConfirmation } from './setFieldConfirmation';
import { ItemHasNoActiveCycleError, UnknownFieldError } from './updateItemFields';

const CYCLE = {
	id: 'cycle-1',
	itemId: 'item-1',
	sequence: 1,
	status: 'ACTIVE' as const,
	createdAt: 'x'
};

function ports(overrides: { cycle?: typeof CYCLE | null; setFieldConfirmed?: () => boolean } = {}) {
	const cycles = {
		getActiveCycle: vi.fn(() => (overrides.cycle === undefined ? CYCLE : overrides.cycle)),
		listCycles: vi.fn(() => []),
		startNextCycle: vi.fn()
	} as CycleRepositoryPort;
	const fields = {
		listFields: vi.fn(() => []),
		addCustomField: vi.fn(),
		removeCustomField: vi.fn(),
		setFieldConfirmed: vi.fn(overrides.setFieldConfirmed ?? (() => true))
	} as FieldRepositoryPort;
	return { cycles, fields };
}

describe('setFieldConfirmation', () => {
	it('confirms exactly one field of the active cycle', () => {
		const p = ports();
		setFieldConfirmation(p, { itemId: 'item-1', fieldKey: 'c_pickup_time', confirmed: true });
		expect(p.fields.setFieldConfirmed).toHaveBeenCalledTimes(1);
		expect(p.fields.setFieldConfirmed).toHaveBeenCalledWith('cycle-1', 'c_pickup_time', true);
	});

	it('can withdraw a confirmation', () => {
		const p = ports();
		setFieldConfirmation(p, { itemId: 'item-1', fieldKey: 'c_pickup_time', confirmed: false });
		expect(p.fields.setFieldConfirmed).toHaveBeenCalledWith('cycle-1', 'c_pickup_time', false);
	});

	it('throws when the item has no active cycle', () => {
		const p = ports({ cycle: null });
		expect(() =>
			setFieldConfirmation(p, { itemId: 'item-1', fieldKey: 'x', confirmed: true })
		).toThrow(ItemHasNoActiveCycleError);
	});

	it('throws for an unknown field and lets repository errors propagate', () => {
		expect(() =>
			setFieldConfirmation(ports({ setFieldConfirmed: () => false }), {
				itemId: 'item-1',
				fieldKey: 'missing',
				confirmed: true
			})
		).toThrow(UnknownFieldError);

		const boom = new Error('no value');
		expect(() =>
			setFieldConfirmation(
				ports({
					setFieldConfirmed: () => {
						throw boom;
					}
				}),
				{ itemId: 'item-1', fieldKey: 'x', confirmed: true }
			)
		).toThrow(boom);
	});
});
