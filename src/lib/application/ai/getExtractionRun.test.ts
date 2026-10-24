import { describe, expect, it, vi } from 'vitest';
import { getExtractionRun, previewActionDates } from './getExtractionRun';

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
			listAdditionalSuggestions: vi.fn(() => []),
			listActionSuggestions: vi.fn(() => [])
		},
		fields: {
			listFields: vi.fn(() => [
				{ fieldKey: 'contract_end', label: 'Contract end', type: 'date', value: null },
				{ fieldKey: 'note', label: 'Note', type: 'text', value: 'same value' }
			])
		},
		actions: { listActions: vi.fn(() => []) },
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
			suggestedValue: '2031-03-15',
			comparison: 'NEW'
		});
	});

	it('moves a suggestion equal to the current value to alreadyPresent, not the decisions', () => {
		const result = getExtractionRun(p_default(), { itemId: 'item-1', runId: 'run-1' });
		expect(result?.suggestions.some((s) => s.fieldKey === 'note')).toBe(false);
		expect(result?.alreadyPresent.map((s) => s.fieldKey)).toEqual(['note']);
		expect(result?.alreadyPresent[0]?.comparison).toBe('ALREADY_PRESENT');
	});

	it('classifies a different non-empty current value as CONFLICTING and trims whitespace only', () => {
		const p = fakePorts({
			runs: {
				...fakePorts().runs,
				listSuggestions: vi.fn(() => [
					{ fieldKey: 'contract_end', value: '2031-03-15', position: 0, accepted: false },
					{ fieldKey: 'note', value: 'same value ', position: 1, accepted: false }
				])
			},
			fields: {
				listFields: vi.fn(() => [
					{ fieldKey: 'contract_end', label: 'Contract end', type: 'date', value: '2030-01-01' },
					{ fieldKey: 'note', label: 'Note', type: 'text', value: ' same value' }
				])
			}
		});
		const result = getExtractionRun(p as never, { itemId: 'item-1', runId: 'run-1' });
		expect(result?.suggestions.map((s) => [s.fieldKey, s.comparison])).toEqual([
			['contract_end', 'CONFLICTING']
		]);
		expect(result?.alreadyPresent.map((s) => s.fieldKey)).toEqual(['note']);
	});

	it('does not fuzzy-match free text (case difference is a conflict)', () => {
		const p = fakePorts({
			runs: {
				...fakePorts().runs,
				listSuggestions: vi.fn(() => [
					{ fieldKey: 'note', value: 'Same Value', position: 0, accepted: false }
				])
			}
		});
		const result = getExtractionRun(p as never, { itemId: 'item-1', runId: 'run-1' });
		expect(result?.suggestions[0]?.comparison).toBe('CONFLICTING');
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
				listActionSuggestions: vi.fn(() => []),
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

	describe('action suggestions', () => {
		function withActions(
			suggestions: unknown[],
			existing: string[] = [],
			fieldValue: string | null = '2031-03-31'
		) {
			const base = fakePorts();
			return fakePorts({
				runs: {
					...base.runs,
					// No suggested field values, so an empty anchor field has no
					// document fallback either.
					listSuggestions: vi.fn(() => []),
					listActionSuggestions: vi.fn(() => suggestions)
				},
				fields: {
					listFields: vi.fn(() => [
						{ fieldKey: 'contract_end', label: 'Contract end', type: 'date', value: fieldValue }
					])
				},
				actions: { listActions: vi.fn(() => existing.map((label) => ({ label }))) }
			});
		}
		const base = {
			context: null,
			evidence: null,
			position: 0,
			accepted: false
		};

		it('resolves a relative date from the Item anchor and keeps availability informational', () => {
			const result = getExtractionRun(
				withActions([
					{
						...base,
						id: 'a',
						title: 'Versicherung kündigen',
						date: {
							kind: 'DUE_BY',
							value: null,
							relative: {
								relation: 'BEFORE',
								amount: 3,
								unit: 'MONTHS',
								anchorFieldKey: 'contract_end'
							}
						}
					},
					{
						...base,
						id: 'b',
						title: 'Online einchecken',
						date: { kind: 'AVAILABLE_FROM', value: '2031-05-01', relative: null }
					}
				]) as never,
				{ itemId: 'item-1', runId: 'run-1' }
			);
			expect(result?.actionSuggestions.map((s) => [s.title, s.date])).toEqual([
				['Versicherung kündigen', { status: 'DUE', kind: 'DUE_BY', date: '2030-12-31' }],
				[
					'Online einchecken',
					{ status: 'INFORMATIONAL', kind: 'AVAILABLE_FROM', date: '2031-05-01' }
				]
			]);
			expect(result?.actionSuggestions[0]?.relative).toEqual({
				relation: 'BEFORE',
				amount: 3,
				unit: 'MONTHS',
				anchorLabel: 'Contract end'
			});
		});

		it('reports an unresolved date, not an invented one, when the anchor is missing', () => {
			const result = getExtractionRun(
				withActions(
					[
						{
							...base,
							id: 'a',
							title: 'Termin bestätigen',
							date: {
								kind: 'DUE_BY',
								value: null,
								relative: {
									relation: 'BEFORE',
									amount: 2,
									unit: 'WEEKS',
									anchorFieldKey: 'contract_end'
								}
							}
						}
					],
					[],
					null
				) as never,
				{ itemId: 'item-1', runId: 'run-1' }
			);
			expect(result?.actionSuggestions[0]?.date).toEqual({ status: 'UNRESOLVED', kind: 'DUE_BY' });
		});

		it('previews a relative Action date from the selected field writes', () => {
			const action = {
				...base,
				id: 'a',
				title: 'Termin bestätigen',
				date: {
					kind: 'DUE_BY',
					value: null,
					relative: {
						relation: 'BEFORE',
						amount: 2,
						unit: 'WEEKS',
						anchorFieldKey: 'contract_end'
					}
				}
			};
			const ports = fakePorts({
				runs: {
					...fakePorts().runs,
					listSuggestions: vi.fn(() => [{ fieldKey: 'contract_end', value: '2031-03-15' }]),
					listActionSuggestions: vi.fn(() => [action])
				},
				fields: {
					listFields: vi.fn(() => [
						{ fieldKey: 'contract_end', label: 'Contract end', type: 'date', value: null }
					])
				}
			});
			const run = { id: 'run-1', cycleId: 'cycle-1' };

			expect(previewActionDates(ports as never, run, { acceptedFieldKeys: [] }).a).toEqual({
				status: 'UNRESOLVED',
				kind: 'DUE_BY'
			});
			expect(
				previewActionDates(ports as never, run, { acceptedFieldKeys: ['contract_end'] }).a
			).toEqual({ status: 'DUE', kind: 'DUE_BY', date: '2031-03-01' });
		});

		it('excludes accepted suggestions and obvious duplicates of existing Actions', () => {
			const none = { kind: 'NONE', value: null, relative: null };
			const result = getExtractionRun(
				withActions(
					[
						{ ...base, id: 'a', title: 'Flug umbuchen', date: none },
						{ ...base, id: 'b', title: 'Hotel prüfen', date: none, accepted: true },
						{ ...base, id: 'c', title: 'Rechnung bezahlen', date: none }
					],
					['flug  Umbuchen']
				) as never,
				{ itemId: 'item-1', runId: 'run-1' }
			);
			expect(result?.actionSuggestions.map((s) => s.id)).toEqual(['c']);
		});
	});

	function p_default() {
		return fakePorts() as never;
	}
});
