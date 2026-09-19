import type { FieldType } from '../../domain/field/field';
import type { FieldRepositoryPort } from '../ports';
import type { ExtractionRun, ExtractionRunRepositoryPort } from './ports';

export interface SuggestionForReview {
	fieldKey: string;
	label: string;
	type: FieldType;
	/** Loaded locally, never sent to the provider (see extraction.ts). */
	currentValue: string | null;
	suggestedValue: string;
}

/** An additional (not-yet-a-field) suggestion as shown for review. Once
 *  accepted it is filtered out here (see below) — it is a normal Custom
 *  Field from then on, not something this review page still tracks. */
export interface AdditionalSuggestionForReview {
	id: string;
	suggestedLabel: string;
	suggestedType: FieldType;
	value: string;
}

export interface ExtractionRunForReview {
	run: ExtractionRun;
	suggestions: SuggestionForReview[];
	additionalSuggestions: AdditionalSuggestionForReview[];
}

/**
 * Joins each persisted suggestion with the field's current label/type/
 * value, so the review page needs no second query. A suggestion whose
 * field no longer exists (e.g. a custom field removed after the run was
 * created) or whose value now equals the current value is not returned —
 * "a suggestion equal to the current value is not rendered at all, since
 * there is nothing to decide" (Slice 9 roadmap). Additional suggestions
 * already accepted (turned into a real field by an earlier "add" batch —
 * AI Extraction 1.1, section 7 allows several) are excluded the same way.
 */
export function getExtractionRun(
	ports: { runs: ExtractionRunRepositoryPort; fields: FieldRepositoryPort },
	input: { itemId: string; runId: string }
): ExtractionRunForReview | null {
	const run = ports.runs.getById(input.runId);
	if (!run || run.itemId !== input.itemId) return null;

	const fieldsByKey = new Map(ports.fields.listFields(run.cycleId).map((f) => [f.fieldKey, f]));

	const suggestions = ports.runs
		.listSuggestions(run.id)
		.map((suggestion) => {
			const field = fieldsByKey.get(suggestion.fieldKey);
			if (!field) return null;
			return {
				fieldKey: suggestion.fieldKey,
				label: field.label,
				type: field.type,
				currentValue: field.value,
				suggestedValue: suggestion.value
			};
		})
		.filter(
			(s): s is SuggestionForReview => s !== null && s.suggestedValue !== (s.currentValue ?? '')
		);

	const additionalSuggestions = ports.runs
		.listAdditionalSuggestions(run.id)
		.filter((s) => !s.accepted)
		.map((s) => ({
			id: s.id,
			suggestedLabel: s.suggestedLabel,
			suggestedType: s.suggestedType,
			value: s.value
		}));

	return { run, suggestions, additionalSuggestions };
}
