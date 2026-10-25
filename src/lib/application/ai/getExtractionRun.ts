import type { FieldType } from '../../domain/field/field';
import type { ActionRepositoryPort, FieldRepositoryPort } from '../ports';
import {
	compareFieldValue,
	selectFieldWrites,
	type FieldComparison,
	type FieldSelection
} from './fieldComparison';
import { isDuplicateActionTitle } from './filterActionSuggestions';
import type { ActionRelativeDate } from './extraction';
import type { ExtractionRun, ExtractionRunRepositoryPort } from './ports';
import {
	collectAnchorDates,
	resolveActionDate,
	type ResolvedActionDate
} from './resolveActionDate';

export interface SuggestionForReview {
	fieldKey: string;
	label: string;
	type: FieldType;
	/** Loaded locally, never sent to the provider (see extraction.ts). */
	currentValue: string | null;
	suggestedValue: string;
	comparison: FieldComparison;
}

/** An additional (not-yet-a-field) suggestion as shown for review. Once
 *  accepted it is filtered out here (see below) — it is a normal Custom
 *  Field from then on, not something this review page still tracks. */
export interface AdditionalSuggestionForReview {
	id: string;
	suggestedLabel: string;
	suggestedType: FieldType;
	value: string;
	evidence: string | null;
}

export interface ActionSuggestionForReview {
	id: string;
	title: string;
	context: string | null;
	evidence: string | null;
	sourceDate: import('./extraction').ActionSuggestionDate;
	/** Calculated now from the Item's current dates; recalculated on accept. */
	date: ResolvedActionDate;
	dateDependencies: string[];
	/** The document's own relative wording, so a date that could not be
	 *  calculated can still say what it was relative to. */
	relative: {
		relation: ActionRelativeDate['relation'];
		amount: number;
		unit: ActionRelativeDate['unit'];
		anchorLabel: string;
	} | null;
}

export interface ExtractionRunForReview {
	run: ExtractionRun;
	/** NEW and CONFLICTING values only: the ones that need a decision. */
	suggestions: SuggestionForReview[];
	/** Values the Item already holds. Shown quietly, never applied. */
	alreadyPresent: SuggestionForReview[];
	additionalSuggestions: AdditionalSuggestionForReview[];
	actionSuggestions: ActionSuggestionForReview[];
	datePreviewFields: { fieldKey: string; type: string; value: string | null }[];
	datePreviewSuggestions: { fieldKey: string; value: string }[];
}

export function previewActionDates(
	ports: { runs: ExtractionRunRepositoryPort; fields: FieldRepositoryPort },
	run: { id: string; cycleId: string },
	selection: FieldSelection
): Record<string, ResolvedActionDate> {
	const fields = ports.fields.listFields(run.cycleId);
	return resolveActionDatesForSelection(
		fields,
		ports.runs.listSuggestions(run.id),
		ports.runs.listActionSuggestions(run.id),
		selection
	);
}

export function resolveActionDatesForSelection(
	fields: readonly { fieldKey: string; type: string; value: string | null }[],
	fieldSuggestions: readonly { fieldKey: string; value: string }[],
	actionSuggestions: readonly { id: string; date: import('./extraction').ActionSuggestionDate }[],
	selection: FieldSelection
): Record<string, ResolvedActionDate> {
	const writes = selectFieldWrites(fields, fieldSuggestions, selection).writes;
	const saved = new Map(writes.map((write) => [write.fieldKey, write.value]));
	const anchors = collectAnchorDates(
		fields.map((field) => ({ ...field, value: saved.get(field.fieldKey) ?? field.value })),
		new Map()
	);
	return Object.fromEntries(
		actionSuggestions.map((suggestion) => [
			suggestion.id,
			resolveActionDate(suggestion.date, anchors)
		])
	);
}

/**
 * Joins each persisted suggestion with the field's current label/type/
 * value, so the review page needs no second query, and classifies it
 * (NEW / ALREADY_PRESENT / CONFLICTING). A suggestion whose field no
 * longer exists (e.g. a custom field removed after the run was created) is
 * not returned. Additional suggestions already accepted (turned into a real
 * field by an earlier "add" batch — AI Extraction 1.1, section 7 allows
 * several) are excluded the same way. Action suggestions that were already
 * accepted, or that now duplicate an existing Action on the Item, are
 * excluded too.
 */
export function getExtractionRun(
	ports: {
		runs: ExtractionRunRepositoryPort;
		fields: FieldRepositoryPort;
		actions: ActionRepositoryPort;
	},
	input: { itemId: string; runId: string }
): ExtractionRunForReview | null {
	const run = ports.runs.getById(input.runId);
	if (!run || run.itemId !== input.itemId) return null;

	const fields = ports.fields.listFields(run.cycleId);
	const fieldsByKey = new Map(fields.map((f) => [f.fieldKey, f]));
	const storedSuggestions = ports.runs.listSuggestions(run.id);

	const classified = storedSuggestions
		.map((suggestion): SuggestionForReview | null => {
			const field = fieldsByKey.get(suggestion.fieldKey);
			if (!field) return null;
			return {
				fieldKey: suggestion.fieldKey,
				label: field.label,
				type: field.type,
				currentValue: field.value,
				suggestedValue: suggestion.value,
				comparison: compareFieldValue(field.value, suggestion.value)
			};
		})
		.filter((s): s is SuggestionForReview => s !== null);

	const suggestions = classified.filter((s) => s.comparison !== 'ALREADY_PRESENT');
	const alreadyPresent = classified.filter((s) => s.comparison === 'ALREADY_PRESENT');

	const additionalSuggestions = ports.runs
		.listAdditionalSuggestions(run.id)
		.filter((s) => !s.accepted)
		.map((s) => ({
			id: s.id,
			suggestedLabel: s.suggestedLabel,
			suggestedType: s.suggestedType,
			value: s.value,
			evidence: s.evidence
		}));

	const existingActionTitles = ports.actions.listActions(run.cycleId).map((a) => a.label);
	const anchorDates = collectAnchorDates(
		fields,
		new Map(storedSuggestions.map((s) => [s.fieldKey, s.value]))
	);
	const actionSuggestions = ports.runs
		.listActionSuggestions(run.id)
		.filter((s) => !s.accepted && !isDuplicateActionTitle(s.title, existingActionTitles))
		.map((s) => ({
			id: s.id,
			title: s.title,
			context: s.context,
			evidence: s.evidence,
			sourceDate: s.date,
			date: resolveActionDate(s.date, anchorDates),
			dateDependencies: s.date.relative?.anchorFieldKey ? [s.date.relative.anchorFieldKey] : [],
			relative: s.date.relative
				? {
						relation: s.date.relative.relation,
						amount: s.date.relative.amount,
						unit: s.date.relative.unit,
						anchorLabel:
							(s.date.relative.anchorFieldKey
								? fieldsByKey.get(s.date.relative.anchorFieldKey)?.label
								: s.date.relative.anchorLabel) ?? ''
					}
				: null
		}));

	const anchorKeys = new Set(
		actionSuggestions.flatMap((suggestion) => suggestion.dateDependencies)
	);
	return {
		run,
		suggestions,
		alreadyPresent,
		additionalSuggestions,
		actionSuggestions,
		datePreviewFields: fields
			.filter((field) => anchorKeys.has(field.fieldKey))
			.map(({ fieldKey, type, value }) => ({ fieldKey, type, value })),
		datePreviewSuggestions: storedSuggestions
			.filter((suggestion) => anchorKeys.has(suggestion.fieldKey))
			.map(({ fieldKey, value }) => ({ fieldKey, value }))
	};
}
