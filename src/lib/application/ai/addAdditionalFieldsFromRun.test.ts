import { describe, expect, it, vi } from 'vitest';
import {
	addAdditionalFieldsFromRun,
	ExtractionRunNotFoundError,
	FieldLabelRequiredError,
	InvalidCurrencyValueError,
	InvalidDateValueError
} from './addAdditionalFieldsFromRun';

function fakePorts(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		runs: {
			getById: vi.fn(() => ({
				id: 'run-1',
				itemId: 'item-1',
				cycleId: 'cycle-1',
				status: 'NEW'
			})),
			addAdditionalFields: vi.fn()
		},
		...overrides
	};
}

describe('addAdditionalFieldsFromRun (AI Extraction 1.1: accepted suggestions become ordinary Custom Fields)', () => {
	it('throws when the run does not exist or belongs to a different item', () => {
		const p = fakePorts({ runs: { getById: vi.fn(() => null), addAdditionalFields: vi.fn() } });
		expect(() =>
			addAdditionalFieldsFromRun(p as never, { itemId: 'item-1', runId: 'missing', selections: [] })
		).toThrow(ExtractionRunNotFoundError);
	});

	it('a user can rename a suggested field before adding it', () => {
		const p = fakePorts();
		addAdditionalFieldsFromRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			selections: [
				{ suggestionId: 'sug-1', label: 'Renamed Label', type: 'text', value: 'CUPRA Born' }
			]
		});
		expect(p.runs.addAdditionalFields).toHaveBeenCalledWith({
			runId: 'run-1',
			itemId: 'item-1',
			cycleId: 'cycle-1',
			selections: [
				{ suggestionId: 'sug-1', label: 'Renamed Label', type: 'text', value: 'CUPRA Born' }
			]
		});
	});

	it('combines a currency amount and code into the canonical stored value', () => {
		const p = fakePorts();
		addAdditionalFieldsFromRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			selections: [
				{
					suggestionId: 'sug-1',
					label: 'Monatliche Rate',
					type: 'currency',
					value: '351',
					currencyCode: 'EUR'
				}
			]
		});
		expect(p.runs.addAdditionalFields).toHaveBeenCalledWith(
			expect.objectContaining({
				selections: [
					{ suggestionId: 'sug-1', label: 'Monatliche Rate', type: 'currency', value: '351.00 EUR' }
				]
			})
		);
	});

	it('rejects an empty label before ever calling the repository', () => {
		const p = fakePorts();
		expect(() =>
			addAdditionalFieldsFromRun(p as never, {
				itemId: 'item-1',
				runId: 'run-1',
				selections: [{ suggestionId: 'sug-1', label: '   ', type: 'text', value: 'x' }]
			})
		).toThrow(FieldLabelRequiredError);
		expect(p.runs.addAdditionalFields).not.toHaveBeenCalled();
	});

	it('rejects an invalid date value before ever calling the repository', () => {
		const p = fakePorts();
		expect(() =>
			addAdditionalFieldsFromRun(p as never, {
				itemId: 'item-1',
				runId: 'run-1',
				selections: [{ suggestionId: 'sug-1', label: 'Termin', type: 'date', value: 'no-a-date' }]
			})
		).toThrow(InvalidDateValueError);
		expect(p.runs.addAdditionalFields).not.toHaveBeenCalled();
	});

	it('rejects an invalid currency code before ever calling the repository', () => {
		const p = fakePorts();
		expect(() =>
			addAdditionalFieldsFromRun(p as never, {
				itemId: 'item-1',
				runId: 'run-1',
				selections: [
					{
						suggestionId: 'sug-1',
						label: 'Rate',
						type: 'currency',
						value: '351.00',
						currencyCode: ''
					}
				]
			})
		).toThrow(InvalidCurrencyValueError);
		expect(p.runs.addAdditionalFields).not.toHaveBeenCalled();
	});

	it('when one of several selections is invalid, the repository is never called for any of them (atomic)', () => {
		const p = fakePorts();
		expect(() =>
			addAdditionalFieldsFromRun(p as never, {
				itemId: 'item-1',
				runId: 'run-1',
				selections: [
					{ suggestionId: 'sug-1', label: 'Fahrzeugmodell', type: 'text', value: 'CUPRA Born' },
					{ suggestionId: 'sug-2', label: 'Termin', type: 'date', value: 'not-a-date' }
				]
			})
		).toThrow(InvalidDateValueError);
		expect(p.runs.addAdditionalFields).not.toHaveBeenCalled();
	});

	it('passes multiple valid selections through together, for one atomic repository call, and reports how many were added', () => {
		const p = fakePorts();
		const result = addAdditionalFieldsFromRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			selections: [
				{ suggestionId: 'sug-1', label: 'Fahrzeugmodell', type: 'text', value: 'CUPRA Born' },
				{ suggestionId: 'sug-2', label: 'Vertragsdauer', type: 'text', value: '48 Monate' }
			]
		});
		expect(result).toEqual({ addedCount: 2 });
		expect(p.runs.addAdditionalFields).toHaveBeenCalledTimes(1);
		expect(p.runs.addAdditionalFields).toHaveBeenCalledWith(
			expect.objectContaining({
				selections: [
					{ suggestionId: 'sug-1', label: 'Fahrzeugmodell', type: 'text', value: 'CUPRA Born' },
					{ suggestionId: 'sug-2', label: 'Vertragsdauer', type: 'text', value: '48 Monate' }
				]
			})
		);
	});
});
