import { isIsoDate } from '../../domain/date/isoDate';
import { isValidCurrencyStorageValue } from '../../domain/field/field';
import type { ExtractionFieldDefinition, ExtractionSuggestion } from './extraction';

export type DiscardReason =
	| 'EMPTY'
	| 'UNKNOWN_FIELD'
	| 'DUPLICATE'
	| 'TOO_LONG'
	| 'INVALID_DATE'
	| 'INVALID_CURRENCY'
	| 'OVER_LIMIT';

export interface DiscardedSuggestion {
	fieldKey: string;
	reason: DiscardReason;
}

export interface FilterSuggestionsResult {
	kept: ExtractionSuggestion[];
	discarded: DiscardedSuggestion[];
}

const MAX_VALUE_LENGTH = 500;

/**
 * The trust boundary between untrusted model output and this Item's real
 * data. Applied after the strict Zod parse (extractionOutputSchema),
 * before anything is persisted. Rules run in order, first match wins: a
 * suggestion equal to the current value is NOT filtered here (this
 * function never sees current values at all — see extraction.ts) — that
 * comparison happens locally on the review page instead.
 */
export function filterSuggestions(
	suggestions: readonly ExtractionSuggestion[],
	fields: readonly ExtractionFieldDefinition[]
): FilterSuggestionsResult {
	const fieldsByKey = new Map(fields.map((f) => [f.fieldKey, f]));
	const seen = new Set<string>();
	const kept: ExtractionSuggestion[] = [];
	const discarded: DiscardedSuggestion[] = [];

	for (const suggestion of suggestions) {
		const fieldKey = suggestion.fieldKey;
		const value = suggestion.value.trim();

		if (!value) {
			discarded.push({ fieldKey, reason: 'EMPTY' });
			continue;
		}
		const field = fieldsByKey.get(fieldKey);
		if (!field) {
			discarded.push({ fieldKey, reason: 'UNKNOWN_FIELD' });
			continue;
		}
		if (seen.has(fieldKey)) {
			discarded.push({ fieldKey, reason: 'DUPLICATE' });
			continue;
		}
		// The key is claimed by its first occurrence right here, before any
		// further validation of *this* occurrence's value — "keeping the
		// first" (see the roadmap's stated rule order: DUPLICATE is checked
		// before TOO_LONG/INVALID_DATE) means the first occurrence wins the
		// slot even if it goes on to fail validation; a later, otherwise
		// valid repeat of the same key must not be able to "rescue" it
		// (review round-02 finding 7).
		seen.add(fieldKey);

		if (value.length > MAX_VALUE_LENGTH) {
			discarded.push({ fieldKey, reason: 'TOO_LONG' });
			continue;
		}
		if (field.type === 'date' && !isIsoDate(value)) {
			discarded.push({ fieldKey, reason: 'INVALID_DATE' });
			continue;
		}
		if (field.type === 'currency' && !isValidCurrencyStorageValue(value)) {
			discarded.push({ fieldKey, reason: 'INVALID_CURRENCY' });
			continue;
		}
		if (kept.length >= fields.length) {
			discarded.push({ fieldKey, reason: 'OVER_LIMIT' });
			continue;
		}

		kept.push({ fieldKey, value });
	}

	return { kept, discarded };
}
