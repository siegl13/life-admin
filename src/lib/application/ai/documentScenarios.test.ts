import { describe, expect, it, vi } from 'vitest';
import { applyExtractionRun } from './applyExtractionRun';
import { planActionSelections } from './addActionsFromRun';
import { buildExtractionContract } from './extractionContract';
import { filterActionSuggestions } from './filterActionSuggestions';
import { filterAdditionalSuggestions } from './filterAdditionalSuggestions';
import { filterSuggestions } from './filterSuggestions';
import { getExtractionRun } from './getExtractionRun';
import type {
	ExtractionActionSuggestion,
	ExtractionAdditionalSuggestion,
	ExtractionFieldDefinition,
	ExtractionSuggestion
} from './extraction';

/**
 * Synthetic documents only. Each scenario hands the filters, the review
 * and the apply step the output a provider could plausibly return for a
 * document, and asserts what the user would be asked to decide. Which
 * provider output a real model produces is steered by the contract
 * (asserted at the end); everything after the provider call is
 * deterministic and tested here.
 */

interface StoredField {
	fieldKey: string;
	label: string;
	type: 'text' | 'date' | 'currency';
	value: string | null;
}

const NOW = '2026-01-01T00:00:00.000Z';

const TRIP_FIELDS: StoredField[] = [
	{ fieldKey: 'outbound_date', label: 'Hinflug Datum', type: 'date', value: null },
	{ fieldKey: 'destination', label: 'Reiseziel', type: 'text', value: null },
	{ fieldKey: 'hotel', label: 'Hotel', type: 'text', value: null },
	{ fieldKey: 'operator', label: 'Reiseveranstalter', type: 'text', value: null }
];

function definitions(fields: readonly StoredField[]): ExtractionFieldDefinition[] {
	return fields.map(({ fieldKey, label, type }) => ({ fieldKey, label, type }));
}

interface ProviderOutput {
	suggestions?: ExtractionSuggestion[];
	additional?: ExtractionAdditionalSuggestion[];
	actions?: ExtractionActionSuggestion[];
}

/** The persisted run, as `extractFromDocument` stores the filtered output. */
function runPorts(
	fields: StoredField[],
	output: ProviderOutput,
	existingActionLabels: string[] = []
) {
	const defs = definitions(fields);
	const suggestions = filterSuggestions(output.suggestions ?? [], defs).kept;
	const additional = filterAdditionalSuggestions(output.additional ?? [], defs).kept;
	const actions = filterActionSuggestions(output.actions ?? [], defs, existingActionLabels).kept;
	return {
		runs: {
			getById: vi.fn(() => ({ id: 'run-1', itemId: 'item-1', cycleId: 'cycle-1', status: 'NEW' })),
			listSuggestions: vi.fn(() =>
				suggestions.map((s, position) => ({ ...s, position, accepted: false }))
			),
			listAdditionalSuggestions: vi.fn(() =>
				additional.map((s, index) => ({
					...s,
					id: `add-${index}`,
					position: index,
					accepted: false
				}))
			),
			listActionSuggestions: vi.fn(() =>
				actions.map((s, index) => ({ ...s, id: `act-${index}`, position: index, accepted: false }))
			),
			applyRun: vi.fn()
		},
		fields: { listFields: vi.fn(() => fields) },
		actions: { listActions: vi.fn(() => existingActionLabels.map((label) => ({ label }))) },
		clock: {
			nowIso: vi.fn(() => NOW),
			todayIso: vi.fn(() => '2026-01-01'),
			localHour: vi.fn(() => 12)
		}
	};
}

const review = (p: ReturnType<typeof runPorts>) =>
	getExtractionRun(p as never, { itemId: 'item-1', runId: 'run-1' })!;

describe('document field semantics: outbound and return', () => {
	const outbound = { ...TRIP_FIELDS[0]!, value: '2027-05-01' };
	const fields = [outbound, ...TRIP_FIELDS.slice(1)];

	it('keeps the return ticket out of the outbound and trip fields and offers it as additional information', () => {
		const p = runPorts(fields, {
			suggestions: [
				{ fieldKey: 'outbound_date', value: '2027-05-01' },
				{ fieldKey: 'destination', value: 'Lissabon' }
			],
			additional: [
				{ suggestedLabel: 'Rückflug Datum', suggestedType: 'date', value: '2027-05-08' },
				{ suggestedLabel: 'Rückflug Zielort', suggestedType: 'text', value: 'Berlin' }
			]
		});
		const result = review(p);

		expect(result.suggestions.filter((s) => s.comparison === 'CONFLICTING')).toEqual([]);
		expect(result.alreadyPresent.map((s) => s.fieldKey)).toEqual(['outbound_date']);
		expect(result.suggestions.map((s) => [s.fieldKey, s.comparison])).toEqual([
			['destination', 'NEW']
		]);
		expect(result.additionalSuggestions.map((s) => [s.suggestedLabel, s.value])).toEqual([
			['Rückflug Datum', '2027-05-08'],
			['Rückflug Zielort', 'Berlin']
		]);
	});

	it('does not suggest an identical value redundantly', () => {
		const result = review(
			runPorts(fields, { suggestions: [{ fieldKey: 'outbound_date', value: '2027-05-01' }] })
		);
		expect(result.suggestions).toEqual([]);
		expect(result.alreadyPresent).toHaveLength(1);
	});

	it('drops an additional value whose label already is a field of the Item', () => {
		const result = review(
			runPorts(fields, {
				additional: [
					{ suggestedLabel: ' hinflug datum', suggestedType: 'date', value: '2027-05-01' }
				]
			})
		);
		expect(result.additionalSuggestions).toEqual([]);
	});
});

describe('document field semantics: hotel versus tour operator', () => {
	it('keeps the operator out of the hotel field', () => {
		const fields = TRIP_FIELDS.map((f) =>
			f.fieldKey === 'hotel' ? { ...f, value: 'Hotel Sonne' } : f
		);
		const result = review(
			runPorts(fields, {
				suggestions: [{ fieldKey: 'operator', value: 'Sunway Reisen GmbH' }],
				additional: [
					{ suggestedLabel: 'Hotel Adresse', suggestedType: 'text', value: 'Strandweg 1' }
				]
			})
		);
		expect(result.suggestions.map((s) => [s.fieldKey, s.comparison])).toEqual([
			['operator', 'NEW']
		]);
		expect(result.additionalSuggestions.map((s) => s.suggestedLabel)).toEqual(['Hotel Adresse']);
	});
});

describe('genuine conflicts', () => {
	const fields = TRIP_FIELDS.map((f) =>
		f.fieldKey === 'hotel' ? { ...f, value: 'Hotel Sonne' } : f
	);
	const output = {
		suggestions: [
			{ fieldKey: 'hotel', value: 'Hotel Mond' },
			{ fieldKey: 'destination', value: 'Lissabon' }
		]
	};

	it('shows both the current and the document value', () => {
		const conflict = review(runPorts(fields, output)).suggestions.find(
			(s) => s.fieldKey === 'hotel'
		)!;
		expect(conflict).toMatchObject({
			comparison: 'CONFLICTING',
			currentValue: 'Hotel Sonne',
			suggestedValue: 'Hotel Mond'
		});
	});

	it('is not resolved by accept all, and still offers new values', () => {
		const p = runPorts(fields, output);
		const result = applyExtractionRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			acceptedFieldKeys: [],
			replaceFieldKeys: ['hotel'],
			acceptAllNew: true
		});
		const call = p.runs.applyRun.mock.calls[0]![0] as { updates: { fieldKey: string }[] };
		expect(call.updates.map((u) => u.fieldKey)).toEqual(['destination']);
		expect(result).toMatchObject({ changedCount: 1, keptCurrentCount: 1 });
	});

	it('replaces only on explicit selection', () => {
		const p = runPorts(fields, output);
		applyExtractionRun(p as never, {
			itemId: 'item-1',
			runId: 'run-1',
			acceptedFieldKeys: [],
			replaceFieldKeys: ['hotel']
		});
		const call = p.runs.applyRun.mock.calls[0]![0] as { updates: { fieldKey: string }[] };
		expect(call.updates.map((u) => u.fieldKey)).toEqual(['hotel']);
	});
});

describe('Action Suggestions from explicit instructions', () => {
	const fields: StoredField[] = [
		{ fieldKey: 'departure', label: 'Abflug', type: 'date', value: '2027-05-01' },
		{ fieldKey: 'contract_end', label: 'Vertragsende', type: 'date', value: null }
	];
	const none = { kind: 'NONE' as const, value: null, relative: null };
	const action = (
		title: string,
		date: ExtractionActionSuggestion['date'] = none
	): ExtractionActionSuggestion => ({ title, context: null, evidence: `„${title}“`, date });
	const describeDate = (kind: string, date: string) => `${kind} ${date}`;

	function planned(
		output: ProviderOutput,
		fieldList: StoredField[] = fields,
		existing: string[] = []
	) {
		const p = runPorts(fieldList, output, existing);
		const { selections } = planActionSelections(
			p as never,
			{ id: 'run-1', cycleId: 'cycle-1' },
			{
				selectedSuggestionIds: p.runs.listActionSuggestions().map((s) => s.id),
				describeDate: describeDate as never
			}
		);
		return { p, selections };
	}

	it('keeps an arrive-before-departure instruction without an invented time or date', () => {
		const { selections } = planned({
			actions: [action('10 Minuten vor Abflug am Gate sein')]
		});
		expect(selections).toHaveLength(1);
		expect(selections[0]).toMatchObject({
			label: '10 Minuten vor Abflug am Gate sein',
			dueDate: null
		});
	});

	it('keeps an explicit identity instruction without inventing a deadline', () => {
		const { selections } = planned({ actions: [action('Identitätsprüfung durchführen')] });
		expect(selections[0]).toMatchObject({
			label: 'Identitätsprüfung durchführen',
			dueDate: null
		});
	});

	it('keeps a conditional collection obligation and its unknown deadline in context', () => {
		const context = 'Innerhalb von 14 Tagen nach Zugang der Bereitstellungsanzeige abholen.';
		const { p, selections } = planned({
			actions: [{ ...action('Fahrzeug abholen'), context }]
		});
		expect(review(p).actionSuggestions[0]!.context).toBe(context);
		expect(selections[0]).toMatchObject({ description: context, dueDate: null });
	});

	it('keeps a return-at-agreement-end obligation when the end date is unknown', () => {
		const context = 'Das Fahrzeug ist bei Vertragsende zurückzugeben.';
		const { selections } = planned({
			actions: [{ ...action('Fahrzeug zurückgeben'), context }]
		});
		expect(selections[0]).toMatchObject({
			label: 'Fahrzeug zurückgeben',
			description: context,
			dueDate: null
		});
	});

	it('does not invent a cancellation Action when the provider omits an optional withdrawal right', () => {
		// Conforming provider output, not a test of live-model recognition.
		const { p, selections } = planned({
			suggestions: [{ fieldKey: 'departure', value: '2027-05-01' }],
			actions: []
		});
		expect(review(p).actionSuggestions).toEqual([]);
		expect(selections).toEqual([]);
		expect(review(p).alreadyPresent[0]!.fieldKey).toBe('departure');
	});

	it('treats an online check-in opportunity as availability, never as a deadline', () => {
		const { selections } = planned({
			actions: [
				action('Online einchecken', {
					kind: 'AVAILABLE_FROM',
					value: null,
					relative: {
						relation: 'BEFORE',
						amount: 1,
						unit: 'DAYS',
						anchorFieldKey: 'departure'
					}
				})
			]
		});
		expect(selections[0]!.dueDate).toBeNull();
		expect(selections[0]!.description).toBe('AVAILABLE_FROM 2027-04-30');
	});

	it('uses an explicit payment deadline as the due date', () => {
		const { selections } = planned({
			actions: [
				action('Rechnung bezahlen', { kind: 'DUE_BY', value: '2026-02-14', relative: null })
			]
		});
		expect(selections[0]!.dueDate).toBe('2026-02-14');
	});

	it('calculates a cancellation date only from a date the Item has', () => {
		const output = {
			actions: [
				action('Vertrag kündigen', {
					kind: 'DUE_BY' as const,
					value: null,
					relative: {
						relation: 'BEFORE' as const,
						amount: 3,
						unit: 'MONTHS' as const,
						anchorFieldKey: 'contract_end'
					}
				})
			]
		};
		expect(planned(output).selections[0]!.dueDate).toBeNull();
		const withEnd = fields.map((f) =>
			f.fieldKey === 'contract_end' ? { ...f, value: '2027-06-30' } : f
		);
		expect(planned(output, withEnd).selections[0]!.dueDate).toBe('2027-03-30');
	});

	it('does not invent an anchor when the document anchor is ambiguous or missing', () => {
		const { selections } = planned({
			actions: [
				action('Zahlung leisten', {
					kind: 'DUE_BY',
					value: '2026-03-01',
					relative: {
						relation: 'AFTER',
						amount: 14,
						unit: 'DAYS',
						anchorFieldKey: null,
						anchorDate: null,
						anchorLabel: null
					}
				})
			]
		});
		expect(selections[0]!.dueDate).toBeNull();
	});

	it('creates nothing without an explicit selection and plain Actions with one', () => {
		const p = runPorts(fields, { actions: [action('Rechnung bezahlen')] });
		const result = review(p);
		expect(result.actionSuggestions).toHaveLength(1);
		expect(result.actionSuggestions[0]!.evidence).toBe('„Rechnung bezahlen“');
		const { selections } = planActionSelections(
			p as never,
			{ id: 'run-1', cycleId: 'cycle-1' },
			{ selectedSuggestionIds: [], describeDate: describeDate as never }
		);
		expect(selections).toEqual([]);
	});

	it('does not duplicate an Action when the same document is analysed again', () => {
		const first = planned({ actions: [action('Rechnung bezahlen')] });
		const acceptedTitle = first.selections[0]!.label;

		const second = runPorts(fields, { actions: [action('Rechnung  bezahlen')] }, [acceptedTitle]);
		expect(second.runs.listActionSuggestions()).toEqual([]);
		expect(review(second).actionSuggestions).toEqual([]);
	});

	it('drops a repeated suggestion within one run', () => {
		const { selections } = planned({
			actions: [action('Rechnung bezahlen'), action('rechnung bezahlen')]
		});
		expect(selections).toHaveLength(1);
	});
});

describe('extraction contract guidance', () => {
	const contract = buildExtractionContract(definitions(TRIP_FIELDS));

	it('separates related fields and routes doubtful values to additional information', () => {
		expect(contract).toContain('genau dieselbe Bedeutung');
		expect(contract).toContain('Hinflug und Rückflug');
		expect(contract).toContain('Hotel und Reiseveranstalter');
		expect(contract).toContain('lass ihn in "suggestions" weg');
	});

	it('limits Actions to explicit instructions and forbids generic recommendations', () => {
		expect(contract).toContain(
			'nur vor, wenn das Dokument ihn ausdrücklich verlangt oder anbietet'
		);
		expect(contract).toContain('Eine bloße Zeitangabe');
		expect(contract).toContain('Erfinde keine allgemeinen Empfehlungen');
		expect(contract).toContain('Koffer packen');
	});

	it('distinguishes availability from a deadline and forbids invented precision', () => {
		expect(contract).toContain('"AVAILABLE_FROM" und nicht "DUE_BY"');
		expect(contract).toContain('nur, wenn sie im Dokument stehen');
		expect(contract).toContain('"10 Minuten vor Abflug"');
	});
});
