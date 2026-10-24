import { describe, expect, it } from 'vitest';
import type { ExtractionActionSuggestion } from './extraction';
import { extractionOutputSchema } from './extractionOutputSchema';
import { filterActionSuggestions, isDuplicateActionTitle } from './filterActionSuggestions';
import { resolveActionDate } from './resolveActionDate';

const fields = [
	{ fieldKey: 'contract_end', label: 'Contract end', type: 'date' as const },
	{ fieldKey: 'note', label: 'Note', type: 'text' as const }
];

function suggestion(
	overrides: Partial<ExtractionActionSuggestion> = {}
): ExtractionActionSuggestion {
	return {
		title: 'Unterlagen einreichen',
		context: null,
		evidence: null,
		status: 'OPEN',
		date: { kind: 'NONE', value: null, relative: null },
		...overrides
	};
}

describe('filterActionSuggestions', () => {
	it('keeps generic actions from any domain: travel, tax, insurance, vehicle', () => {
		const result = filterActionSuggestions(
			[
				suggestion({ title: 'Online einchecken' }),
				suggestion({ title: 'Steuererklärung abgeben' }),
				suggestion({ title: 'Versicherung kündigen' }),
				suggestion({ title: 'Reifen wechseln' })
			],
			fields,
			[]
		);
		expect(result.kept.map((s) => s.title)).toEqual([
			'Online einchecken',
			'Steuererklärung abgeben',
			'Versicherung kündigen',
			'Reifen wechseln'
		]);
		expect(result.discarded).toEqual([]);
	});

	it('discards empty titles and steps the document describes as already done', () => {
		const result = filterActionSuggestions(
			[suggestion({ title: '   ' }), suggestion({ title: 'Bezahlt', status: 'ALREADY_DONE' })],
			fields,
			[]
		);
		expect(result.kept).toEqual([]);
		expect(result.discarded.map((d) => d.reason)).toEqual(['EMPTY_TITLE', 'ALREADY_DONE']);
	});

	it('discards an obvious duplicate of an existing Action using simple normalization only', () => {
		const result = filterActionSuggestions(
			[suggestion({ title: '  FLUG   umbuchen ' }), suggestion({ title: 'Flug stornieren' })],
			fields,
			['Flug umbuchen']
		);
		expect(result.kept.map((s) => s.title)).toEqual(['Flug stornieren']);
		expect(result.discarded[0]?.reason).toBe('DUPLICATE_OF_EXISTING_ACTION');
	});

	it('discards a repeated suggestion within the same document', () => {
		const result = filterActionSuggestions(
			[suggestion({ title: 'Termin buchen' }), suggestion({ title: 'termin buchen' })],
			fields,
			[]
		);
		expect(result.kept).toHaveLength(1);
		expect(result.discarded[0]?.reason).toBe('DUPLICATE');
	});

	it('drops an unknown anchor and keeps a valid one, ignoring any pre-calculated value next to it', () => {
		const relative = (anchorFieldKey: string) => ({
			relation: 'BEFORE' as const,
			amount: 2,
			unit: 'WEEKS' as const,
			anchorFieldKey
		});
		const result = filterActionSuggestions(
			[
				suggestion({
					title: 'A',
					date: { kind: 'DUE_BY', value: '2031-01-01', relative: relative('unknown') }
				}),
				suggestion({
					title: 'B',
					date: { kind: 'DUE_BY', value: '2031-01-01', relative: relative('contract_end') }
				}),
				suggestion({
					title: 'C',
					date: { kind: 'DUE_BY', value: null, relative: relative('note') }
				})
			],
			fields,
			[]
		);
		// The rejected anchor must not promote the model's own date to a deadline.
		expect(result.kept[0]?.date).toEqual({ kind: 'DUE_BY', value: null, relative: null });
		expect(result.kept[1]?.date).toEqual({
			kind: 'DUE_BY',
			value: null,
			relative: relative('contract_end')
		});
		// A non-date field is not an anchor.
		expect(result.kept[2]?.date.relative).toBeNull();
	});

	it('drops an invalid absolute date instead of storing it and clears the date for NONE', () => {
		const result = filterActionSuggestions(
			[
				suggestion({ title: 'A', date: { kind: 'DUE_BY', value: '31.12.2031', relative: null } }),
				suggestion({ title: 'B', date: { kind: 'NONE', value: '2031-01-01', relative: null } })
			],
			fields,
			[]
		);
		expect(result.kept[0]?.date.value).toBeNull();
		expect(result.kept[1]?.date).toEqual({ kind: 'NONE', value: null, relative: null });
	});
});

describe('relative dates after filtering', () => {
	const relative = (extra: object) => ({
		relation: 'BEFORE' as const,
		amount: 2,
		unit: 'WEEKS' as const,
		anchorFieldKey: null,
		...extra
	});
	const resolveFiltered = (
		date: ExtractionActionSuggestion['date'],
		anchors = new Map<string, string>([['contract_end', '2031-03-31']])
	) => {
		const kept = filterActionSuggestions([suggestion({ date })], fields, []).kept[0]!;
		return resolveActionDate(kept.date, anchors as never);
	};

	it('never turns the model’s own date into a deadline when the relative anchor is rejected', () => {
		expect(
			resolveFiltered({
				kind: 'DUE_BY',
				value: '2031-01-01',
				relative: relative({ anchorFieldKey: 'unknown' })
			})
		).toEqual({ status: 'UNRESOLVED', kind: 'DUE_BY' });
	});

	it('calculates from an explicit, labelled document date', () => {
		expect(
			resolveFiltered({
				kind: 'DUE_BY',
				value: null,
				relative: relative({ anchorDate: '2031-06-15', anchorLabel: 'Abflug' })
			})
		).toEqual({ status: 'DUE', kind: 'DUE_BY', date: '2031-06-01' });
	});

	it.each([
		['a missing document date', { anchorDate: null, anchorLabel: 'Abflug' }],
		['an ambiguous document date', { anchorDate: '15.06.', anchorLabel: 'Abflug' }],
		['a document date without a label', { anchorDate: '2031-06-15', anchorLabel: ' ' }]
	])('leaves the date unresolved for %s', (_name, anchor) => {
		expect(
			resolveFiltered({
				kind: 'DUE_BY',
				value: '2031-01-01',
				relative: relative(anchor)
			})
		).toEqual({ status: 'UNRESOLVED', kind: 'DUE_BY' });
	});
});

/**
 * Paired source-text cases: what a conforming model returns for text that
 * implies a step and for text that is only information. The model's
 * judgement itself cannot be tested without calling it, so `modelOutput` is
 * a fixture. These cases prove that the contract's output shape is accepted,
 * that informational text yields no Action, and that the pipeline adds none.
 */
describe('actionable versus informational document text', () => {
	const cases = [
		{
			domain: 'travel',
			actionable: 'Bitte checken Sie spätestens 24 Stunden vor Abflug online ein.',
			actionTitle: 'Online einchecken',
			informational: 'Ihr Flug LH123 startet um 08:15 Uhr von Terminal 2.'
		},
		{
			domain: 'tax',
			actionable: 'Reichen Sie die Erklärung bis zum 31.07.2031 beim Finanzamt ein.',
			actionTitle: 'Steuererklärung einreichen',
			informational: 'Der Steuersatz für diesen Bescheid beträgt 19 Prozent.'
		},
		{
			domain: 'insurance',
			actionable: 'Eine Kündigung ist nur schriftlich möglich. Bitte senden Sie sie rechtzeitig.',
			actionTitle: 'Versicherung schriftlich kündigen',
			informational: 'Die Versicherungssumme beträgt 250.000 Euro.'
		},
		{
			domain: 'vehicle',
			actionable: 'Die Hauptuntersuchung ist fällig. Bitte vereinbaren Sie einen Termin.',
			actionTitle: 'Termin für die Hauptuntersuchung vereinbaren',
			informational: 'Das Fahrzeug hat 48.000 km und eine Erstzulassung im Jahr 2024.'
		}
	];

	it.each(cases)('$domain: a step becomes one suggestion', ({ actionable, actionTitle }) => {
		const parsed = extractionOutputSchema.parse({
			suggestions: [],
			action_suggestions: [
				{
					title: actionTitle,
					context: null,
					evidence: actionable,
					status: 'OPEN',
					date: { kind: 'NONE', value: null, relative: null }
				}
			]
		});
		const mapped = (parsed.action_suggestions ?? []).map((s) =>
			suggestion({ title: s.title, evidence: s.evidence ?? null })
		);
		const result = filterActionSuggestions(mapped, fields, []);
		expect(result.kept.map((s) => s.title)).toEqual([actionTitle]);
		expect(result.kept[0]?.evidence).toBe(actionable);
	});

	it.each(cases)('$domain: plain information yields no suggestion', ({ informational }) => {
		// An informational statement belongs in an Item field. The model returns an
		// empty list; nothing downstream invents an Action from the text.
		const parsed = extractionOutputSchema.parse({ suggestions: [], action_suggestions: [] });
		expect(informational.length).toBeGreaterThan(0);
		expect(filterActionSuggestions([], fields, []).kept).toEqual([]);
		expect(parsed.action_suggestions).toEqual([]);
	});
});

describe('isDuplicateActionTitle', () => {
	it('matches case, diacritics and whitespace only', () => {
		expect(isDuplicateActionTitle('Kündigung  prüfen', ['kundigung prufen'])).toBe(true);
		expect(isDuplicateActionTitle('Kündigung prüfen', ['Kündigung fristgerecht prüfen'])).toBe(
			false
		);
	});
});
