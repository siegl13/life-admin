/**
 * How a document value relates to what the Item already holds:
 * - NEW: the field is empty, so applying it cannot overwrite anything.
 * - ALREADY_PRESENT: the field already holds this value. Nothing to decide.
 * - CONFLICTING: the field holds a different value. Only an explicit user
 *   choice may replace it.
 */
export type FieldComparison = 'NEW' | 'ALREADY_PRESENT' | 'CONFLICTING';

/**
 * Deliberately conservative: surrounding whitespace is ignored, nothing
 * else. Dates and currency amounts are stored in one canonical form, so
 * exact comparison is correct for them; free text is never fuzzy-matched.
 * Used both to render the review and again when applying, so a value that
 * changed in between is re-classified instead of trusted from the form.
 */
export function compareFieldValue(current: string | null, suggested: string): FieldComparison {
	const currentValue = current?.trim() ?? '';
	if (currentValue === '') return 'NEW';
	return currentValue === suggested.trim() ? 'ALREADY_PRESENT' : 'CONFLICTING';
}

export interface FieldSelection {
	acceptedFieldKeys: readonly string[];
	replaceFieldKeys?: readonly string[];
	acceptAllNew?: boolean;
}

/**
 * The field writes the user's selection results in, classified against the
 * Item's current values. Shared by `applyExtractionRun` and the Action
 * planning so an Action's relative date is calculated from the values that
 * are actually saved.
 */
export function selectFieldWrites(
	fields: readonly { fieldKey: string; value: string | null }[],
	suggestions: readonly { fieldKey: string; value: string }[],
	selection: FieldSelection
): { writes: { fieldKey: string; value: string }[]; keptCurrentCount: number } {
	const currentByKey = new Map(fields.map((field) => [field.fieldKey, field.value]));
	const accepted = new Set(selection.acceptedFieldKeys);
	const replace = new Set(selection.acceptAllNew ? [] : (selection.replaceFieldKeys ?? []));

	const writes: { fieldKey: string; value: string }[] = [];
	let keptCurrentCount = 0;
	for (const suggestion of suggestions) {
		const fieldKey = suggestion.fieldKey;
		const selected = selection.acceptAllNew || accepted.has(fieldKey) || replace.has(fieldKey);
		if (!selected) continue;
		// A selected key whose field was removed since the run was created
		// is treated as empty here, so normalizeFieldUpdates rejects it
		// with UnknownFieldError exactly as before.

		const comparison = compareFieldValue(currentByKey.get(fieldKey) ?? null, suggestion.value);
		if (comparison === 'ALREADY_PRESENT') continue;
		if (comparison === 'CONFLICTING' && !replace.has(fieldKey)) {
			keptCurrentCount += 1;
			continue;
		}
		writes.push({ fieldKey, value: suggestion.value });
	}
	return { writes, keptCurrentCount };
}
