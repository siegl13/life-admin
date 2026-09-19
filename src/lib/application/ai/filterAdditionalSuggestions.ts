import { isIsoDate } from '../../domain/date/isoDate';
import { isValidCurrencyStorageValue } from '../../domain/field/field';
import type {
	ExtractionAdditionalSuggestion,
	ExtractionFieldDefinition,
	SuggestedFieldType
} from './extraction';

export type AdditionalDiscardReason =
	| 'EMPTY_LABEL'
	| 'EMPTY_VALUE'
	| 'UNSUPPORTED_TYPE'
	| 'DUPLICATE_OF_EXISTING_FIELD'
	| 'DUPLICATE'
	| 'TOO_LONG'
	| 'INVALID_DATE'
	| 'INVALID_CURRENCY'
	| 'OVER_LIMIT';

export interface DiscardedAdditionalSuggestion {
	suggestedLabel: string;
	reason: AdditionalDiscardReason;
}

export interface FilterAdditionalSuggestionsResult {
	kept: ExtractionAdditionalSuggestion[];
	discarded: DiscardedAdditionalSuggestion[];
}

const MAX_LABEL_LENGTH = 200;
const MAX_VALUE_LENGTH = 500;
/** Conservative cap on additional suggestions kept per run (AI Extraction
 *  1.1, section 11) — the schema already caps the raw provider array to
 *  30 (extractionOutputSchema.ts); this is the same number enforced again
 *  here, the trust boundary for *content* rather than *shape*. */
const MAX_ADDITIONAL_SUGGESTIONS = 30;
const SUPPORTED_TYPES: readonly SuggestedFieldType[] = ['text', 'date', 'currency'];

/**
 * Normalizes a label for the "obvious duplicate" check only:
 * case/diacritic/whitespace-insensitive equality, nothing semantic. This
 * is the deliberately small, non-AI safety net the roadmap asks for
 * ("smallest robust approach... do not introduce embeddings or another AI
 * call just for deduplication") — the model itself is instructed
 * (extractionContract.ts) to avoid semantic near-duplicates like
 * "Jahreskilometer" vs. "Jährliche Fahrleistung"; this function only
 * guarantees the exact-same-thing-under-different-casing case can never
 * slip through even if that instruction is ignored.
 */
function normalizeLabel(label: string): string {
	return label.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

/**
 * The trust boundary for additional (not-yet-a-field) suggestions,
 * mirroring `filterSuggestions.ts` for known fields: applied after the
 * strict Zod parse, before anything is shown for review or ever written
 * to `cycle_fields`. A suggestion whose (normalized) label already
 * matches an existing field on this Item is dropped as an obvious
 * duplicate — see `normalizeLabel` above for the limits of that check.
 */
export function filterAdditionalSuggestions(
	suggestions: readonly ExtractionAdditionalSuggestion[],
	existingFields: readonly ExtractionFieldDefinition[]
): FilterAdditionalSuggestionsResult {
	const existingLabels = new Set(existingFields.map((f) => normalizeLabel(f.label)));
	const seen = new Set<string>();
	const kept: ExtractionAdditionalSuggestion[] = [];
	const discarded: DiscardedAdditionalSuggestion[] = [];

	for (const suggestion of suggestions) {
		const label = suggestion.suggestedLabel.trim();
		const value = suggestion.value.trim();

		if (!label) {
			discarded.push({ suggestedLabel: label, reason: 'EMPTY_LABEL' });
			continue;
		}
		if (!value) {
			discarded.push({ suggestedLabel: label, reason: 'EMPTY_VALUE' });
			continue;
		}
		if (!SUPPORTED_TYPES.includes(suggestion.suggestedType)) {
			discarded.push({ suggestedLabel: label, reason: 'UNSUPPORTED_TYPE' });
			continue;
		}

		const normalized = normalizeLabel(label);
		if (existingLabels.has(normalized)) {
			discarded.push({ suggestedLabel: label, reason: 'DUPLICATE_OF_EXISTING_FIELD' });
			continue;
		}
		// Claimed right here, before any further validation of *this*
		// occurrence's value — same rule-order reasoning as
		// filterSuggestions.ts: the first occurrence wins the slot even if
		// it goes on to fail validation, so a later, otherwise-valid repeat
		// of the same label can never "rescue" it.
		if (seen.has(normalized)) {
			discarded.push({ suggestedLabel: label, reason: 'DUPLICATE' });
			continue;
		}
		seen.add(normalized);

		if (label.length > MAX_LABEL_LENGTH || value.length > MAX_VALUE_LENGTH) {
			discarded.push({ suggestedLabel: label, reason: 'TOO_LONG' });
			continue;
		}
		if (suggestion.suggestedType === 'date' && !isIsoDate(value)) {
			discarded.push({ suggestedLabel: label, reason: 'INVALID_DATE' });
			continue;
		}
		if (suggestion.suggestedType === 'currency' && !isValidCurrencyStorageValue(value)) {
			discarded.push({ suggestedLabel: label, reason: 'INVALID_CURRENCY' });
			continue;
		}
		if (kept.length >= MAX_ADDITIONAL_SUGGESTIONS) {
			discarded.push({ suggestedLabel: label, reason: 'OVER_LIMIT' });
			continue;
		}

		kept.push({ suggestedLabel: label, suggestedType: suggestion.suggestedType, value });
	}

	return { kept, discarded };
}
