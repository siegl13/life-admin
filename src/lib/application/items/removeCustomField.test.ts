import { describe, expect, it, vi } from 'vitest';
import type { CycleRepositoryPort, FieldRepositoryPort } from '../ports';
import { removeCustomField } from './removeCustomField';
import { ItemHasNoActiveCycleError } from './updateItemFields';

const CYCLE = {
	id: 'cycle-1',
	itemId: 'item-1',
	sequence: 1,
	status: 'ACTIVE' as const,
	createdAt: 'x'
};

describe('removeCustomField (application use case)', () => {
	it('throws if the item has no active cycle', () => {
		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(() => null),
			listCycles: vi.fn(() => []),
			startNextCycle: vi.fn(() => {
				throw new Error('not used in this test');
			})
		};
		const fields: FieldRepositoryPort = {
			listFields: vi.fn(() => []),
			addCustomField: vi.fn(),
			removeCustomField: vi.fn()
		};
		expect(() =>
			removeCustomField({ cycles, fields }, { itemId: 'item-1', fieldKey: 'c_note' })
		).toThrow(ItemHasNoActiveCycleError);
	});

	it('delegates to the field repository for the item active cycle', () => {
		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(() => CYCLE),
			listCycles: vi.fn(() => []),
			startNextCycle: vi.fn(() => {
				throw new Error('not used in this test');
			})
		};
		const fields: FieldRepositoryPort = {
			listFields: vi.fn(() => []),
			addCustomField: vi.fn(),
			removeCustomField: vi.fn()
		};
		removeCustomField({ cycles, fields }, { itemId: 'item-1', fieldKey: 'c_note' });
		expect(fields.removeCustomField).toHaveBeenCalledWith(CYCLE.id, 'c_note');
	});

	it('lets a repository error (e.g. trying to remove a PLAYBOOK field) propagate', () => {
		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(() => CYCLE),
			listCycles: vi.fn(() => []),
			startNextCycle: vi.fn(() => {
				throw new Error('not used in this test');
			})
		};
		const boom = new Error('cannot remove playbook field');
		const fields: FieldRepositoryPort = {
			listFields: vi.fn(() => []),
			addCustomField: vi.fn(),
			removeCustomField: vi.fn(() => {
				throw boom;
			})
		};
		expect(() =>
			removeCustomField({ cycles, fields }, { itemId: 'item-1', fieldKey: 'valid_until' })
		).toThrow(boom);
	});
});
