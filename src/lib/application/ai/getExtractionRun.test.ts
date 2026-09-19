import { describe, expect, it, vi } from 'vitest';
import { getExtractionRun } from './getExtractionRun';

function fakePorts(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		runs: {
			getById: vi.fn(() => ({
				id: 'run-1',
				itemId: 'item-1',
				cycleId: 'cycle-1',
				status: 'NEW',
				suggestedCount: 2,
				discardedCount: 1,
				createdAt: '2026-01-01T00:00:00.000Z',
				reviewedAt: null
			})),
			listSuggestions: vi.fn(() => [
				{ fieldKey: 'contract_end', value: '2031-03-15', position: 0, accepted: false },
				{ fieldKey: 'note', value: 'same value', position: 1, accepted: false }
			]),
			listAdditionalSuggestions: vi.fn(() => [])
		},
		fields: {
			listFields: vi.fn(() => [
				{ fieldKey: 'contract_end', label: 'Contract end', type: 'date', value: null },
				{ fieldKey: 'note', label: 'Note', type: 'text', value: 'same value' }
			])
		},
		...overrides
	};
}

describe('getExtractionRun', () => {
	it('returns null when the run does not exist or belongs to a different item', () => {
		const p = fakePorts({ runs: { getById: vi.fn(() => null), listSuggestions: vi.fn() } });
		expect(getExtractionRun(p as never, { itemId: 'item-1', runId: 'missing' })).toBeNull();
	});

	it('joins each suggestion with the field’s current label/type/value', () => {
		const result = getExtractionRun(p_default(), { itemId: 'item-1', runId: 'run-1' });
		const contractEnd = result?.suggestions.find((s) => s.fieldKey === 'contract_end');
		expect(contractEnd).toEqual({
			fieldKey: 'contract_end',
			label: 'Contract end',
			type: 'date',
			currentValue: null,
			suggestedValue: '2031-03-15'
		});
	});

	it('hides a suggestion equal to the current value', () => {
		const result = getExtractionRun(p_default(), { itemId: 'item-1', runId: 'run-1' });
		expect(result?.suggestions.some((s) => s.fieldKey === 'note')).toBe(false);
	});

	it('excludes a suggestion whose field no longer exists on the cycle', () => {
		const p = fakePorts({ fields: { listFields: vi.fn(() => []) } });
		const result = getExtractionRun(p as never, { itemId: 'item-1', runId: 'run-1' });
		expect(result?.suggestions).toEqual([]);
	});

	it('returns additional suggestions and excludes ones already accepted', () => {
		const p = fakePorts({
			runs: {
				getById: vi.fn(() => ({
					id: 'run-1',
					itemId: 'item-1',
					cycleId: 'cycle-1',
					status: 'NEW',
					suggestedCount: 0,
					discardedCount: 0,
					createdAt: '2026-01-01T00:00:00.000Z',
					reviewedAt: null
				})),
				listSuggestions: vi.fn(() => []),
				listAdditionalSuggestions: vi.fn(() => [
					{
						id: 'sug-1',
						suggestedLabel: 'Monatliche Rate',
						suggestedType: 'currency',
						value: '351.00 EUR',
						position: 0,
						accepted: false
					},
					{
						id: 'sug-2',
						suggestedLabel: 'Already accepted',
						suggestedType: 'text',
						value: 'x',
						position: 1,
						accepted: true
					}
				])
			}
		});
		const result = getExtractionRun(p as never, { itemId: 'item-1', runId: 'run-1' });
		expect(result?.additionalSuggestions).toEqual([
			{
				id: 'sug-1',
				suggestedLabel: 'Monatliche Rate',
				suggestedType: 'currency',
				value: '351.00 EUR'
			}
		]);
	});

	function p_default() {
		return fakePorts() as never;
	}
});
