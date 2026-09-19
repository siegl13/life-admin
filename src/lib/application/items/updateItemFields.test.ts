import { describe, expect, it, vi } from 'vitest';
import type { Field } from '../../domain/field/field';
import type { CycleRepositoryPort, FieldRepositoryPort, ScheduleRepositoryPort } from '../ports';
import {
	InvalidCurrencyValueError,
	InvalidDateValueError,
	ItemHasNoActiveCycleError,
	UnknownFieldError,
	updateItemFields
} from './updateItemFields';

const CYCLE = {
	id: 'cycle-1',
	itemId: 'item-1',
	sequence: 1,
	status: 'ACTIVE' as const,
	createdAt: 'x'
};

function field(overrides: Partial<Field>): Field {
	return {
		id: 'f1',
		cycleId: CYCLE.id,
		fieldKey: 'valid_until',
		label: 'Valid until',
		type: 'date',
		origin: 'PLAYBOOK',
		recommended: true,
		position: 0,
		value: null,
		...overrides
	};
}

function ports(fields: Field[], cycle: typeof CYCLE | null = CYCLE) {
	const applied: unknown[] = [];
	const cycles: CycleRepositoryPort = {
		getActiveCycle: vi.fn(() => cycle),
		listCycles: vi.fn(() => []),
		startNextCycle: vi.fn(() => {
			throw new Error('not used in this test');
		})
	};
	const fieldsPort: FieldRepositoryPort = {
		listFields: vi.fn(() => fields),
		addCustomField: vi.fn(),
		removeCustomField: vi.fn()
	};
	const schedule: ScheduleRepositoryPort = {
		applyFieldUpdatesAndRecalculate: vi.fn((_cycleId, updates) => {
			applied.push(...updates);
		})
	};
	return { cycles, fields: fieldsPort, schedule, applied };
}

describe('updateItemFields', () => {
	it('throws if the item has no active cycle', () => {
		const p = ports([], null);
		expect(() => updateItemFields(p, { itemId: 'item-1', updates: [] })).toThrow(
			ItemHasNoActiveCycleError
		);
	});

	it('rejects an update targeting an unknown field key', () => {
		const p = ports([field({})]);
		expect(() =>
			updateItemFields(p, { itemId: 'item-1', updates: [{ fieldKey: 'ghost', value: 'x' }] })
		).toThrow(UnknownFieldError);
	});

	it('rejects a non-ISO value for a date field', () => {
		const p = ports([field({ type: 'date' })]);
		expect(() =>
			updateItemFields(p, {
				itemId: 'item-1',
				updates: [{ fieldKey: 'valid_until', value: '31/12/2026' }]
			})
		).toThrow(InvalidDateValueError);
	});

	it('accepts a valid ISO date for a date field', () => {
		const p = ports([field({ type: 'date' })]);
		updateItemFields(p, {
			itemId: 'item-1',
			updates: [{ fieldKey: 'valid_until', value: '2026-12-25' }]
		});
		expect(p.applied).toEqual([{ fieldKey: 'valid_until', value: '2026-12-25' }]);
	});

	it('treats an empty string as clearing the field to null (never mandatory)', () => {
		const p = ports([field({ type: 'text', fieldKey: 'note', recommended: false })]);
		updateItemFields(p, { itemId: 'item-1', updates: [{ fieldKey: 'note', value: '   ' }] });
		expect(p.applied).toEqual([{ fieldKey: 'note', value: null }]);
	});

	it('does not validate ISO format for a text field', () => {
		const p = ports([field({ type: 'text', fieldKey: 'note', recommended: false })]);
		expect(() =>
			updateItemFields(p, { itemId: 'item-1', updates: [{ fieldKey: 'note', value: 'anything' }] })
		).not.toThrow();
	});

	it('combines a raw amount and currency code into the canonical stored value', () => {
		const p = ports([field({ type: 'currency', fieldKey: 'rate', recommended: false })]);
		updateItemFields(p, {
			itemId: 'item-1',
			updates: [{ fieldKey: 'rate', value: '351', currencyCode: 'eur' }]
		});
		expect(p.applied).toEqual([{ fieldKey: 'rate', value: '351.00 EUR' }]);
	});

	it('preserves an exact two-decimal amount for a currency field without float rounding', () => {
		const p = ports([field({ type: 'currency', fieldKey: 'special_payment', recommended: false })]);
		updateItemFields(p, {
			itemId: 'item-1',
			updates: [{ fieldKey: 'special_payment', value: '6740.66', currencyCode: 'EUR' }]
		});
		expect(p.applied).toEqual([{ fieldKey: 'special_payment', value: '6740.66 EUR' }]);
	});

	it('rejects a currency field update with no (or an invalid) currency code', () => {
		const p = ports([field({ type: 'currency', fieldKey: 'rate', recommended: false })]);
		expect(() =>
			updateItemFields(p, {
				itemId: 'item-1',
				updates: [{ fieldKey: 'rate', value: '351.00', currencyCode: 'nope' }]
			})
		).toThrow(InvalidCurrencyValueError);
	});

	it('treats an empty amount as clearing a currency field to null', () => {
		const p = ports([field({ type: 'currency', fieldKey: 'rate', recommended: false })]);
		updateItemFields(p, {
			itemId: 'item-1',
			updates: [{ fieldKey: 'rate', value: '', currencyCode: 'EUR' }]
		});
		expect(p.applied).toEqual([{ fieldKey: 'rate', value: null }]);
	});

	// Regression: an accepted *known-field* AI suggestion for a currency
	// field (applyExtractionRun.ts) has no separate amount/code to send —
	// its value is already the full canonical string, unlike a hand-typed
	// form update or an accepted additional suggestion (both of which always
	// pass `currencyCode`). Re-running it through the amount+code path broke
	// with an uncaught InvalidCurrencyValueError (500) the first time a
	// currency field was also a known field.
	it('accepts an already-canonical currency value when no currency code is given', () => {
		const p = ports([field({ type: 'currency', fieldKey: 'rate', recommended: false })]);
		updateItemFields(p, {
			itemId: 'item-1',
			updates: [{ fieldKey: 'rate', value: '45.00 EUR' }]
		});
		expect(p.applied).toEqual([{ fieldKey: 'rate', value: '45.00 EUR' }]);
	});

	it('rejects a malformed currency value given without a currency code', () => {
		const p = ports([field({ type: 'currency', fieldKey: 'rate', recommended: false })]);
		expect(() =>
			updateItemFields(p, {
				itemId: 'item-1',
				updates: [{ fieldKey: 'rate', value: '45.00' }]
			})
		).toThrow(InvalidCurrencyValueError);
	});
});
