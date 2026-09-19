import { describe, expect, it, vi } from 'vitest';
import type { Field } from '../../domain/field/field';
import type { CycleRepositoryPort, FieldRepositoryPort } from '../ports';
import { addCustomField, FieldLabelRequiredError } from './addCustomField';
import { ItemHasNoActiveCycleError } from './updateItemFields';

const CYCLE = {
	id: 'cycle-1',
	itemId: 'item-1',
	sequence: 1,
	status: 'ACTIVE' as const,
	createdAt: 'x'
};

describe('addCustomField (application use case)', () => {
	it('rejects a blank label', () => {
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
		expect(() =>
			addCustomField({ cycles, fields }, { itemId: 'item-1', label: '  ', type: 'text' })
		).toThrow(FieldLabelRequiredError);
		expect(fields.addCustomField).not.toHaveBeenCalled();
	});

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
			addCustomField({ cycles, fields }, { itemId: 'item-1', label: 'Note', type: 'text' })
		).toThrow(ItemHasNoActiveCycleError);
	});

	it('delegates to the field repository with the trimmed label', () => {
		const cycles: CycleRepositoryPort = {
			getActiveCycle: vi.fn(() => CYCLE),
			listCycles: vi.fn(() => []),
			startNextCycle: vi.fn(() => {
				throw new Error('not used in this test');
			})
		};
		const createdField: Field = {
			id: 'f1',
			cycleId: CYCLE.id,
			fieldKey: 'c_note',
			label: 'Note',
			type: 'text',
			origin: 'CUSTOM',
			recommended: false,
			position: 0,
			value: null
		};
		const fields: FieldRepositoryPort = {
			listFields: vi.fn(() => []),
			addCustomField: vi.fn(() => createdField),
			removeCustomField: vi.fn()
		};

		const result = addCustomField(
			{ cycles, fields },
			{ itemId: 'item-1', label: '  Note  ', type: 'text' }
		);

		expect(fields.addCustomField).toHaveBeenCalledWith(CYCLE.id, { label: 'Note', type: 'text' });
		expect(result).toBe(createdField);
	});
});
