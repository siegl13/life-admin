import type { IsoDate } from '../../domain/date/isoDate';
import type { ActionRepositoryPort, FieldRepositoryPort } from '../ports';
import { ExtractionRunNotFoundError } from './applyExtractionRun';
import { selectFieldWrites, type FieldSelection } from './fieldComparison';
import { isDuplicateActionTitle } from './filterActionSuggestions';
import type { AddActionFromRunSelection, ExtractionRunRepositoryPort } from './ports';
import { collectAnchorDates, resolveActionDate } from './resolveActionDate';

export { ExtractionRunNotFoundError };

export interface ActionSelectionInput {
	/** Raw suggestion ids as posted by the browser. Only ids that belong to
	 *  this run and are not yet accepted are used. */
	selectedSuggestionIds: readonly string[];
	/** Wording for a date that is information, not a deadline. Passed in
	 *  because the stored text is localized by the caller. */
	describeDate: (kind: 'AVAILABLE_FROM' | 'APPROXIMATE', date: IsoDate) => string;
	/** The field choices submitted together with the Actions. When set,
	 *  relative dates anchor on the values that will actually be saved
	 *  (accepted new values, explicit replacements), not on the old or the
	 *  unapproved document value. When omitted, a still-empty date field
	 *  falls back to this document's value, as on the review page. */
	fieldSelection?: FieldSelection;
}

export interface AddActionsFromRunInput extends ActionSelectionInput {
	itemId: string;
	runId: string;
}

export interface AddActionsFromRunResult {
	createdCount: number;
	/** Selected but not created: an Action with the same title already
	 *  exists on the Item. */
	skippedDuplicateCount: number;
}

/**
 * Turns the selected Action suggestions into ordinary Actions. Nothing is
 * created without an explicit selection, and the resulting rows are plain
 * MANUAL Actions: no AI marker, no separate type.
 *
 * Dates are recalculated here from the Item's current dates, not taken
 * from what the review page showed. DUE_BY and ON_DATE set the due date;
 * AVAILABLE_FROM and APPROXIMATE only add a note to the description, and an
 * unresolved relative date leaves the Action undated. Nothing is invented.
 */
export function addActionsFromRun(
	ports: {
		runs: ExtractionRunRepositoryPort;
		fields: FieldRepositoryPort;
		actions: ActionRepositoryPort;
	},
	input: AddActionsFromRunInput
): AddActionsFromRunResult {
	const run = ports.runs.getById(input.runId);
	if (!run || run.itemId !== input.itemId) throw new ExtractionRunNotFoundError();

	const { selections, skippedDuplicateCount } = planActionSelections(ports, run, input);
	if (selections.length > 0) {
		ports.runs.addActions({
			runId: run.id,
			itemId: run.itemId,
			cycleId: run.cycleId,
			selections
		});
	}

	return { createdCount: selections.length, skippedDuplicateCount };
}

/**
 * Resolves the selected suggestions to their final Action form without
 * persisting anything, so the caller can create them in the same
 * transaction as the field writes their dates depend on.
 */
export function planActionSelections(
	ports: {
		runs: ExtractionRunRepositoryPort;
		fields: FieldRepositoryPort;
		actions: ActionRepositoryPort;
	},
	run: { id: string; cycleId: string },
	input: ActionSelectionInput,
	fieldSelection: FieldSelection | undefined = input.fieldSelection
): { selections: AddActionFromRunSelection[]; skippedDuplicateCount: number } {
	const selectedIds = new Set(input.selectedSuggestionIds);
	const selected = ports.runs
		.listActionSuggestions(run.id)
		.filter((suggestion) => selectedIds.has(suggestion.id) && !suggestion.accepted);

	const knownTitles = ports.actions.listActions(run.cycleId).map((action) => action.label);
	const anchorDates = effectiveAnchorDates(ports, run, fieldSelection);

	const selections: AddActionFromRunSelection[] = [];
	let skippedDuplicateCount = 0;
	for (const suggestion of selected) {
		if (isDuplicateActionTitle(suggestion.title, knownTitles)) {
			skippedDuplicateCount += 1;
			continue;
		}
		knownTitles.push(suggestion.title);

		const date = resolveActionDate(suggestion.date, anchorDates);
		const note = date.status === 'INFORMATIONAL' ? input.describeDate(date.kind, date.date) : null;
		selections.push({
			suggestionId: suggestion.id,
			label: suggestion.title,
			description: [suggestion.context, note].filter(Boolean).join('\n') || null,
			dueDate: date.status === 'DUE' ? date.date : null
		});
	}

	return { selections, skippedDuplicateCount };
}

function effectiveAnchorDates(
	ports: { runs: ExtractionRunRepositoryPort; fields: FieldRepositoryPort },
	run: { id: string; cycleId: string },
	selection: FieldSelection | undefined
) {
	const fields = ports.fields.listFields(run.cycleId);
	const suggestions = ports.runs.listSuggestions(run.id);
	if (!selection) {
		return collectAnchorDates(fields, new Map(suggestions.map((s) => [s.fieldKey, s.value])));
	}
	const saved = new Map(
		selectFieldWrites(fields, suggestions, selection).writes.map((w) => [w.fieldKey, w.value])
	);
	return collectAnchorDates(
		fields.map((field) => ({ ...field, value: saved.get(field.fieldKey) ?? field.value })),
		new Map()
	);
}
