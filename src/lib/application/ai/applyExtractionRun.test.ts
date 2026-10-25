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

	it('hands the stored source excerpt of an accepted suggestion to applyRun, and only for accepted keys', () => {
		const p = fakePorts({
			runs: {
				...fakePorts().runs,
				listSuggestions: vi.fn(() => [
					{
						fieldKey: 'contract_end',
						value: '2031-03-15',
						sourceText: 'Laufzeit bis 15.03.2031',
						position: 0,
						accepted: false
					},
					{ fieldKey: 'note', value: 'hello', sourceText: null, position: 1, accepted: false }
				])
			}
		});
		applyExtractionRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			acceptedFieldKeys: ['contract_end', 'note']
		});
		expect(p.runs.applyRun).toHaveBeenCalledWith(
			expect.objectContaining({
				updates: [
					{ fieldKey: 'contract_end', value: '2031-03-15', sourceText: 'Laufzeit bis 15.03.2031' },
					{ fieldKey: 'note', value: 'hello', sourceText: null }
				]
			})
		);
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
				updates: [{ fieldKey: 'contract_end', value: '2031-03-15', sourceText: null }],
				acceptedFieldKeys: ['contract_end']
			})
		);
		expect(result).toEqual({ changedCount: 1, keptCurrentCount: 0, createdActionCount: 0 });
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
				updates: [{ fieldKey: 'contract_end', value: '2031-03-15', sourceText: null }],
				acceptedFieldKeys: ['contract_end']
			})
		);
		expect(result).toEqual({ changedCount: 1, keptCurrentCount: 0, createdActionCount: 0 });
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
				updates: [{ fieldKey: 'monthly_rate', value: '45.00 EUR', sourceText: null }]
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

	describe('with selected Action suggestions', () => {
		const describeDate = (kind: string, date: string) => `${kind} ${date}`;
		const actionSuggestion = {
			id: 'act-1',
			title: 'Kündigung senden',
			context: null,
			evidence: null,
			date: {
				kind: 'DUE_BY',
				value: null,
				relative: { relation: 'BEFORE', amount: 10, unit: 'DAYS', anchorFieldKey: 'contract_end' }
			},
			position: 0,
			accepted: false
		};

		function portsWithActions(fieldOverride?: unknown) {
			const p = fakePorts(fieldOverride ? { fields: fieldOverride } : {});
			return {
				...p,
				runs: { ...p.runs, listActionSuggestions: vi.fn(() => [actionSuggestion]) },
				actions: { listActions: vi.fn(() => []) }
			};
		}

		it('hands the Action to the same applyRun call, dated from the value that is saved', () => {
			const p = portsWithActions();
			const result = applyExtractionRun(p as never, {
				itemId: 'item-1',
				runId: 'run-1',
				acceptedFieldKeys: ['contract_end'],
				actions: { selectedSuggestionIds: ['act-1'], describeDate: describeDate as never }
			});
			expect(p.runs.applyRun).toHaveBeenCalledTimes(1);
			expect(p.runs.applyRun).toHaveBeenCalledWith(
				expect.objectContaining({
					updates: [{ fieldKey: 'contract_end', value: '2031-03-15', sourceText: null }],
					actions: [expect.objectContaining({ suggestionId: 'act-1', dueDate: '2031-03-05' })]
				})
			);
			expect(result.createdActionCount).toBe(1);
		});

		it('persists nothing, Actions included, when a selected field no longer exists', () => {
			const p = portsWithActions({ listFields: vi.fn(() => []) });
			expect(() =>
				applyExtractionRun(p as never, {
					itemId: 'item-1',
					runId: 'run-1',
					acceptedFieldKeys: ['contract_end'],
					actions: { selectedSuggestionIds: ['act-1'], describeDate: describeDate as never }
				})
			).toThrow(UnknownFieldError);
			expect(p.runs.applyRun).not.toHaveBeenCalled();
		});
	});
});

describe('applyExtractionRun: comparison and conflict safety', () => {
	function portsWithCurrent(current: { contract_end: string | null; note: string | null }) {
		return fakePorts({
			fields: {
				listFields: vi.fn(() => [
					{
						fieldKey: 'contract_end',
						label: 'Contract end',
						type: 'date',
						value: current.contract_end
					},
					{ fieldKey: 'note', label: 'Note', type: 'text', value: current.note }
				])
			}
		});
	}

	function lastApply(p: ReturnType<typeof fakePorts>) {
		return (p.runs.applyRun as ReturnType<typeof vi.fn>).mock.calls[0]![0];
	}

	it('never overwrites a non-empty value that was only selected, not explicitly replaced', () => {
		const p = portsWithCurrent({ contract_end: '2030-01-01', note: null });
		const result = applyExtractionRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			acceptedFieldKeys: ['contract_end', 'note']
		});
		expect(lastApply(p).updates).toEqual([{ fieldKey: 'note', value: 'hello', sourceText: null }]);
		expect(lastApply(p).acceptedFieldKeys).toEqual(['note']);
		expect(result).toEqual({ changedCount: 1, keptCurrentCount: 1, createdActionCount: 0 });
	});

	it('replaces a conflicting value only on the explicit "use document value" choice', () => {
		const p = portsWithCurrent({ contract_end: '2030-01-01', note: null });
		const result = applyExtractionRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			acceptedFieldKeys: [],
			replaceFieldKeys: ['contract_end']
		});
		expect(lastApply(p).updates).toEqual([
			{ fieldKey: 'contract_end', value: '2031-03-15', sourceText: null }
		]);
		expect(result).toEqual({ changedCount: 1, keptCurrentCount: 0, createdActionCount: 0 });
	});

	it('keeping the current value (no replace choice) leaves the field untouched', () => {
		const p = portsWithCurrent({ contract_end: '2030-01-01', note: 'kept' });
		const result = applyExtractionRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			acceptedFieldKeys: [],
			replaceFieldKeys: []
		});
		expect(lastApply(p).updates).toEqual([]);
		expect(result).toEqual({ changedCount: 0, keptCurrentCount: 0, createdActionCount: 0 });
	});

	it('ignores a value the Item already holds (whitespace-trimmed) and does not count it as a change', () => {
		const p = portsWithCurrent({ contract_end: '2031-03-15', note: '  hello ' });
		const result = applyExtractionRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			acceptedFieldKeys: ['contract_end', 'note'],
			replaceFieldKeys: ['note']
		});
		expect(lastApply(p).updates).toEqual([]);
		expect(lastApply(p).acceptedFieldKeys).toEqual([]);
		expect(result).toEqual({ changedCount: 0, keptCurrentCount: 0, createdActionCount: 0 });
	});

	it('re-classifies against the current value: a field filled since review is a conflict, not a silent overwrite', () => {
		const p = portsWithCurrent({ contract_end: '2029-12-31', note: null });
		applyExtractionRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			// The browser still posts it as a NEW (checkbox) selection.
			acceptedFieldKeys: ['contract_end']
		});
		expect(lastApply(p).updates).toEqual([]);
	});

	it('accept all applies every NEW value, ignores identical ones, and leaves conflicts unresolved even with a replace choice', () => {
		const p = fakePorts({
			runs: {
				getById: vi.fn(() => ({
					id: 'run-1',
					itemId: 'item-1',
					cycleId: 'cycle-1',
					status: 'NEW'
				})),
				listSuggestions: vi.fn(() => [
					{ fieldKey: 'contract_end', value: '2031-03-15', position: 0, accepted: false },
					{ fieldKey: 'note', value: 'hello', position: 1, accepted: false },
					{ fieldKey: 'other', value: 'new', position: 2, accepted: false }
				]),
				applyRun: vi.fn()
			},
			fields: {
				listFields: vi.fn(() => [
					{ fieldKey: 'contract_end', label: 'Contract end', type: 'date', value: '2030-01-01' },
					{ fieldKey: 'note', label: 'Note', type: 'text', value: 'hello' },
					{ fieldKey: 'other', label: 'Other', type: 'text', value: null }
				])
			}
		});
		const result = applyExtractionRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			acceptedFieldKeys: [],
			replaceFieldKeys: ['contract_end'],
			acceptAllNew: true
		});
		expect(lastApply(p).updates).toEqual([{ fieldKey: 'other', value: 'new', sourceText: null }]);
		expect(result).toEqual({ changedCount: 1, keptCurrentCount: 1, createdActionCount: 0 });
	});
});
