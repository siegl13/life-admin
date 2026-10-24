import { describe, expect, it, vi } from 'vitest';
import { addActionsFromRun } from './addActionsFromRun';
import { ExtractionRunNotFoundError } from './applyExtractionRun';
import type { ExtractionActionSuggestionRecord } from './ports';

const describeDate = (kind: string, date: string) => `${kind} ${date}`;

function record(
	id: string,
	overrides: Partial<ExtractionActionSuggestionRecord> = {}
): ExtractionActionSuggestionRecord {
	return {
		id,
		title: `Task ${id}`,
		context: null,
		evidence: null,
		date: { kind: 'NONE', value: null, relative: null },
		position: 0,
		accepted: false,
		...overrides
	};
}

function fakePorts(
	suggestions: ExtractionActionSuggestionRecord[],
	existingTitles: string[] = [],
	fieldValues: Record<string, string | null> = { contract_end: '2031-03-31' }
) {
	return {
		runs: {
			getById: vi.fn(() => ({ id: 'run-1', itemId: 'item-1', cycleId: 'cycle-1', status: 'NEW' })),
			listActionSuggestions: vi.fn(() => suggestions),
			listSuggestions: vi.fn(() => []),
			addActions: vi.fn()
		},
		fields: {
			listFields: vi.fn(() =>
				Object.entries(fieldValues).map(([fieldKey, value]) => ({
					fieldKey,
					label: fieldKey,
					type: 'date',
					value
				}))
			)
		},
		actions: { listActions: vi.fn(() => existingTitles.map((label) => ({ label }))) }
	};
}

function run(p: ReturnType<typeof fakePorts>, ids: string[]) {
	return addActionsFromRun(p as never, {
		itemId: 'item-1',
		runId: 'run-1',
		selectedSuggestionIds: ids,
		describeDate: describeDate as never
	});
}

describe('addActionsFromRun', () => {
	it('creates nothing when no suggestion is selected', () => {
		const p = fakePorts([record('a'), record('b')]);
		expect(run(p, [])).toEqual({ createdCount: 0, skippedDuplicateCount: 0 });
		expect(p.runs.addActions).not.toHaveBeenCalled();
	});

	it('creates exactly the selected suggestions as plain actions and ignores unknown or accepted ids', () => {
		const p = fakePorts([record('a'), record('b'), record('c', { accepted: true })]);
		expect(run(p, ['a', 'c', 'not-in-run'])).toEqual({ createdCount: 1, skippedDuplicateCount: 0 });
		expect(p.runs.addActions).toHaveBeenCalledWith({
			runId: 'run-1',
			itemId: 'item-1',
			cycleId: 'cycle-1',
			selections: [{ suggestionId: 'a', label: 'Task a', description: null, dueDate: null }]
		});
	});

	it('rejects a run of another item', () => {
		const p = fakePorts([]);
		p.runs.getById.mockReturnValue({ id: 'run-1', itemId: 'other', cycleId: 'c', status: 'NEW' });
		expect(() => run(p, ['a'])).toThrow(ExtractionRunNotFoundError);
	});

	it('sets the due date for DUE_BY and keeps the context as description', () => {
		const p = fakePorts([
			record('a', {
				title: 'Steuererklärung abgeben',
				context: 'Elektronisch über ELSTER',
				date: { kind: 'DUE_BY', value: '2031-07-31', relative: null }
			})
		]);
		run(p, ['a']);
		expect(p.runs.addActions.mock.calls[0]![0].selections[0]).toMatchObject({
			label: 'Steuererklärung abgeben',
			description: 'Elektronisch über ELSTER',
			dueDate: '2031-07-31'
		});
	});

	it('does not present availability or an estimate as a due date, but keeps it as a note', () => {
		const p = fakePorts([
			record('a', {
				title: 'Online einchecken',
				date: { kind: 'AVAILABLE_FROM', value: '2031-05-01', relative: null }
			}),
			record('b', {
				title: 'Reifen wechseln',
				date: { kind: 'APPROXIMATE', value: '2031-10-01', relative: null }
			})
		]);
		run(p, ['a', 'b']);
		const [first, second] = p.runs.addActions.mock.calls[0]![0].selections;
		expect(first).toMatchObject({
			dueDate: null,
			description: 'AVAILABLE_FROM 2031-05-01'
		});
		expect(second).toMatchObject({ dueDate: null, description: 'APPROXIMATE 2031-10-01' });
	});

	it('calculates a relative date from the Item’s current anchor', () => {
		const p = fakePorts([
			record('a', {
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
			})
		]);
		run(p, ['a']);
		expect(p.runs.addActions.mock.calls[0]![0].selections[0].dueDate).toBe('2030-12-31');
	});

	describe('with the submitted field choices', () => {
		const afterOneDay = record('a', {
			date: {
				kind: 'DUE_BY',
				value: null,
				relative: { relation: 'AFTER', amount: 1, unit: 'DAYS', anchorFieldKey: 'contract_end' }
			}
		});
		const replacement = [
			{ fieldKey: 'contract_end', value: '2032-01-01', position: 0, accepted: false }
		];
		const runWith = (p: ReturnType<typeof fakePorts>, selection: object) =>
			addActionsFromRun(p as never, {
				itemId: 'item-1',
				runId: 'run-1',
				selectedSuggestionIds: ['a'],
				describeDate: describeDate as never,
				fieldSelection: { acceptedFieldKeys: [], ...selection }
			});

		it('uses an explicitly replaced anchor value', () => {
			const p = fakePorts([afterOneDay]);
			p.runs.listSuggestions.mockReturnValue(replacement as never);
			runWith(p, { replaceFieldKeys: ['contract_end'] });
			expect(p.runs.addActions.mock.calls[0]![0].selections[0].dueDate).toBe('2032-01-02');
		});

		it('keeps the current anchor when the conflict is not replaced', () => {
			const p = fakePorts([afterOneDay]);
			p.runs.listSuggestions.mockReturnValue(replacement as never);
			runWith(p, { acceptedFieldKeys: ['contract_end'] });
			expect(p.runs.addActions.mock.calls[0]![0].selections[0].dueDate).toBe('2031-04-01');
		});

		it('does not anchor on a document value that is not approved', () => {
			const p = fakePorts([afterOneDay], [], { contract_end: null });
			p.runs.listSuggestions.mockReturnValue(replacement as never);
			runWith(p, {});
			expect(p.runs.addActions.mock.calls[0]![0].selections[0].dueDate).toBeNull();
		});

		it('uses an approved new anchor value', () => {
			const p = fakePorts([afterOneDay], [], { contract_end: null });
			p.runs.listSuggestions.mockReturnValue(replacement as never);
			runWith(p, { acceptAllNew: true });
			expect(p.runs.addActions.mock.calls[0]![0].selections[0].dueDate).toBe('2032-01-02');
		});
	});

	it('calculates a relative date from an explicit document anchor', () => {
		const p = fakePorts(
			[
				record('a', {
					date: {
						kind: 'DUE_BY',
						value: null,
						relative: {
							relation: 'BEFORE',
							amount: 1,
							unit: 'WEEKS',
							anchorFieldKey: null,
							anchorDate: '2031-06-15',
							anchorLabel: 'Abflug'
						}
					}
				})
			],
			[],
			{}
		);
		run(p, ['a']);
		expect(p.runs.addActions.mock.calls[0]![0].selections[0].dueDate).toBe('2031-06-08');
	});

	it('creates the Action without a date when the anchor is missing', () => {
		const p = fakePorts(
			[
				record('a', {
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
				})
			],
			[],
			{ contract_end: null }
		);
		run(p, ['a']);
		expect(p.runs.addActions.mock.calls[0]![0].selections[0].dueDate).toBeNull();
	});

	it('uses the document’s suggested anchor value when the Item field is still empty', () => {
		const p = fakePorts(
			[
				record('a', {
					date: {
						kind: 'DUE_BY',
						value: null,
						relative: { relation: 'AFTER', amount: 1, unit: 'DAYS', anchorFieldKey: 'contract_end' }
					}
				})
			],
			[],
			{ contract_end: null }
		);
		p.runs.listSuggestions.mockReturnValue([
			{ fieldKey: 'contract_end', value: '2031-03-15', position: 0, accepted: false }
		] as never);
		run(p, ['a']);
		expect(p.runs.addActions.mock.calls[0]![0].selections[0].dueDate).toBe('2031-03-16');
	});

	it('skips an Action whose title already exists on the Item, and a repeat within the selection', () => {
		const p = fakePorts(
			[
				record('a', { title: 'Flug umbuchen' }),
				record('b', { title: 'Hotel prüfen' }),
				record('c', { title: 'hotel  prüfen' })
			],
			['flug umbuchen']
		);
		expect(run(p, ['a', 'b', 'c'])).toEqual({ createdCount: 1, skippedDuplicateCount: 2 });
		expect(
			p.runs.addActions.mock.calls[0]![0].selections.map((s: { label: string }) => s.label)
		).toEqual(['Hotel prüfen']);
	});
});
