import { isIsoDate } from '../../domain/date/isoDate';
import type {
	ActionRelativeDate,
	ExtractionActionSuggestion,
	ExtractionFieldDefinition,
	ActionSuggestionDate
} from './extraction';
import { normalizeLabel } from './filterAdditionalSuggestions';

export type ActionDiscardReason =
	'EMPTY_TITLE' | 'ALREADY_DONE' | 'DUPLICATE_OF_EXISTING_ACTION' | 'DUPLICATE' | 'OVER_LIMIT';

export interface DiscardedActionSuggestion {
	title: string;
	reason: ActionDiscardReason;
}

export interface FilterActionSuggestionsResult {
	kept: ExtractionActionSuggestion[];
	discarded: DiscardedActionSuggestion[];
}

const MAX_ACTION_SUGGESTIONS = 20;

/**
 * Whether a suggested title is an obvious duplicate of an existing Action
 * title. Uses the same simple normalization as additional-field labels
 * (case, diacritics, whitespace): no fuzzy or semantic matching.
 */
export function isDuplicateActionTitle(title: string, existingTitles: readonly string[]): boolean {
	const normalized = normalizeLabel(title);
	return existingTitles.some((existing) => normalizeLabel(existing) === normalized);
}

/**
 * The trust boundary for Action suggestions, applied after the strict Zod
 * parse and before anything is stored. Dates are cleaned, never invented:
 * an invalid absolute date or an unknown anchor is dropped, which leaves
 * the date unresolved at review time.
 */
export function filterActionSuggestions(
	suggestions: readonly ExtractionActionSuggestion[],
	fields: readonly ExtractionFieldDefinition[],
	existingActionTitles: readonly string[]
): FilterActionSuggestionsResult {
	const dateFieldKeys = new Set(fields.filter((f) => f.type === 'date').map((f) => f.fieldKey));
	const seen: string[] = [];
	const kept: ExtractionActionSuggestion[] = [];
	const discarded: DiscardedActionSuggestion[] = [];

	for (const suggestion of suggestions) {
		const title = suggestion.title.trim();
		if (!title) {
			discarded.push({ title, reason: 'EMPTY_TITLE' });
			continue;
		}
		if (suggestion.status === 'ALREADY_DONE') {
			discarded.push({ title, reason: 'ALREADY_DONE' });
			continue;
		}
		if (isDuplicateActionTitle(title, existingActionTitles)) {
			discarded.push({ title, reason: 'DUPLICATE_OF_EXISTING_ACTION' });
			continue;
		}
		if (isDuplicateActionTitle(title, seen)) {
			discarded.push({ title, reason: 'DUPLICATE' });
			continue;
		}
		if (kept.length >= MAX_ACTION_SUGGESTIONS) {
			discarded.push({ title, reason: 'OVER_LIMIT' });
			continue;
		}

		seen.push(title);
		kept.push({
			title,
			context: blankToNull(suggestion.context),
			evidence: blankToNull(suggestion.evidence),
			status: 'OPEN',
			date: cleanDate(suggestion.date, dateFieldKeys)
		});
	}

	return { kept, discarded };
}

function blankToNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim() ?? '';
	return trimmed === '' ? null : trimmed;
}

/** Keeps a relative date only with a known Item date field or an explicit,
 *  valid and labelled document date as its anchor. */
function cleanRelative(
	relative: ActionRelativeDate | null,
	dateFieldKeys: ReadonlySet<string>
): ActionRelativeDate | null {
	if (!relative) return null;
	const { relation, amount, unit } = relative;
	if (relative.anchorFieldKey) {
		return dateFieldKeys.has(relative.anchorFieldKey)
			? { relation, amount, unit, anchorFieldKey: relative.anchorFieldKey }
			: null;
	}
	const anchorDate = relative.anchorDate?.trim() ?? '';
	const anchorLabel = blankToNull(relative.anchorLabel);
	if (!isIsoDate(anchorDate) || !anchorLabel) return null;
	return { relation, amount, unit, anchorFieldKey: null, anchorDate, anchorLabel };
}

function cleanDate(date: ActionSuggestionDate, dateFieldKeys: ReadonlySet<string>) {
	if (date.kind === 'NONE') return { kind: 'NONE' as const, value: null, relative: null };

	const relative = cleanRelative(date.relative, dateFieldKeys);
	// A relative date wins: the model must not pre-calculate, so any absolute
	// value next to it is ignored rather than trusted, even when the relative
	// part itself is rejected (a rejected anchor must not turn the model's own
	// calculation into a deadline).
	const trimmedValue = date.value?.trim() ?? '';
	const value = !date.relative && isIsoDate(trimmedValue) ? trimmedValue : null;
	return { kind: date.kind, value, relative };
}
