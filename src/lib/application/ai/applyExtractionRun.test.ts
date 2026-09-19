import { describe, expect, it, vi } from 'vitest';
import { applyExtractionRun, ExtractionRunNotFoundError } from './applyExtractionRun';
import { UnknownFieldError } from '../items/updateItemFields';

function fakePorts(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		runs: {
			getById: vi.fn(() => ({
				id: 'run-1',
				itemId: 'item-1',
				cycleId: 'cycle-1',
				status: 'NEW'
			})),
			listSuggestions: vi.fn(() => [
				{ fieldKey: 'contract_end', value: '2031-03-15', position: 0, accepted: false },
				{ fieldKey: 'note', value: 'hello', position: 1, accepted: false }
			]),
			applyRun: vi.fn()
		},
		fields: {
			listFields: vi.fn(() => [
				{ fieldKey: 'contract_end', label: 'Contract end', type: 'date', value: null },
				{ fieldKey: 'note', label: 'Note', type: 'text', value: null }
			])
		},
		clock: {
			nowIso: vi.fn(() => '2026-01-01T00:00:00.000Z'),
			todayIso: vi.fn(() => '2026-01-01'),
			localHour: vi.fn(() => 12)
		},
		...overrides
	};
}

describe('applyExtractionRun (invariant: AI is never authoritative without an explicit human review POST)', () => {
	it('throws when the run does not exist or belongs to a different item', () => {
		const p = fakePorts({
			runs: { getById: vi.fn(() => null), listSuggestions: vi.fn(), applyRun: vi.fn() }
		});
		expect(() =>
			applyExtractionRun(p as never, { itemId: 'item-1', runId: 'missing', acceptedFieldKeys: [] })
		).toThrow(ExtractionRunNotFoundError);
	});

	it('accepting none writes nothing through updates but still calls applyRun (marks APPLIED with zero accepted keys)', () => {
		const p = fakePorts();
		applyExtractionRun(p as never, { itemId: 'item-1', runId: 'run-1', acceptedFieldKeys: [] });
		expect(p.runs.applyRun).toHaveBeenCalledWith(
			expect.objectContaining({ updates: [], acceptedFieldKeys: [] })
		);
	});

	it('a subset writes exactly that subset and reports how many were accepted', () => {
		const p = fakePorts();
		const result = applyExtractionRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			acceptedFieldKeys: ['contract_end']
		});
		expect(p.runs.applyRun).toHaveBeenCalledWith(
			expect.objectContaining({
				updates: [{ fieldKey: 'contract_end', value: '2031-03-15' }],
				acceptedFieldKeys: ['contract_end']
			})
		);
		expect(result).toEqual({ acceptedCount: 1 });
	});

	it('a field key posted by the browser that is not in the run is ignored, not trusted, and not counted', () => {
		const p = fakePorts();
		const result = applyExtractionRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			acceptedFieldKeys: ['contract_end', 'not_in_this_run']
		});
		expect(p.runs.applyRun).toHaveBeenCalledWith(
			expect.objectContaining({
				updates: [{ fieldKey: 'contract_end', value: '2031-03-15' }],
				acceptedFieldKeys: ['contract_end']
			})
		);
		expect(result).toEqual({ acceptedCount: 1 });
	});

	// Regression: accepting a suggestion for a `currency`-type known field
	// used to throw an uncaught InvalidCurrencyValueError, because the run's
	// suggestion value is already the full canonical string ("45.00 EUR")
	// and normalizeFieldUpdates tried to reformat it as a bare amount with
	// no currency code — see updateItemFields.ts.
	it('accepts a suggestion for a currency field, whose value is already the canonical stored string', () => {
		const p = fakePorts({
			runs: {
				getById: vi.fn(() => ({
					id: 'run-1',
					itemId: 'item-1',
					cycleId: 'cycle-1',
					status: 'NEW'
				})),
				listSuggestions: vi.fn(() => [
					{ fieldKey: 'monthly_rate', value: '45.00 EUR', position: 0, accepted: false }
				]),
				applyRun: vi.fn()
			},
			fields: {
				listFields: vi.fn(() => [
					{ fieldKey: 'monthly_rate', label: 'Rate', type: 'currency', value: null }
				])
			}
		});
		applyExtractionRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			acceptedFieldKeys: ['monthly_rate']
		});
		expect(p.runs.applyRun).toHaveBeenCalledWith(
			expect.objectContaining({
				updates: [{ fieldKey: 'monthly_rate', value: '45.00 EUR' }]
			})
		);
	});

	it('a field that no longer exists on the cycle surfaces UnknownFieldError', () => {
		const p = fakePorts({ fields: { listFields: vi.fn(() => []) } });
		expect(() =>
			applyExtractionRun(p as never, {
				itemId: 'item-1',
				runId: 'run-1',
				acceptedFieldKeys: ['contract_end']
			})
		).toThrow(UnknownFieldError);
		expect(p.runs.applyRun).not.toHaveBeenCalled();
	});
});
