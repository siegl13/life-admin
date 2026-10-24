import { applyOffset, isIsoDate, type IsoDate } from '../../domain/date/isoDate';
import type { Offset } from '../../domain/date/offset';
import type { ActionRelativeDate, ActionSuggestionDate } from './extraction';

/**
 * - `DUE`: the Action gets this ordinary due date (DUE_BY / ON_DATE).
 * - `INFORMATIONAL`: a date exists but must not become a deadline
 *   (AVAILABLE_FROM / APPROXIMATE). Shown and kept as a note only.
 * - `UNRESOLVED`: a relative date whose anchor is missing or unreliable.
 *   No date is invented.
 * - `NONE`: the suggestion has no date.
 */
export type ResolvedActionDate =
	| { status: 'DUE'; kind: 'DUE_BY' | 'ON_DATE'; date: IsoDate }
	| { status: 'INFORMATIONAL'; kind: 'AVAILABLE_FROM' | 'APPROXIMATE'; date: IsoDate }
	| { status: 'UNRESOLVED'; kind: ActionSuggestionDate['kind'] }
	| { status: 'NONE' };

/**
 * The dates relative suggestions may anchor on. A date field the Item
 * already has wins (the Item is the source of truth); only an empty one
 * falls back to the value this very document suggests for it. Invalid
 * values are skipped, so a bad anchor cannot produce a date.
 */
export function collectAnchorDates(
	fields: readonly { fieldKey: string; type: string; value: string | null }[],
	documentValues: ReadonlyMap<string, string>
): Map<string, IsoDate> {
	const anchors = new Map<string, IsoDate>();
	for (const field of fields) {
		if (field.type !== 'date') continue;
		const current = field.value?.trim() ?? '';
		const candidate = current !== '' ? current : (documentValues.get(field.fieldKey)?.trim() ?? '');
		if (isIsoDate(candidate)) anchors.set(field.fieldKey, candidate);
	}
	return anchors;
}

const OFFSET_KEY = { DAYS: 'days', WEEKS: 'weeks', MONTHS: 'months', YEARS: 'years' } as const;

/**
 * Pure and deterministic: the model names a relation, this function does
 * the calendar arithmetic with the same `applyOffset` playbooks use.
 * `anchorDates` maps an Item date field key to its usable ISO date; a key
 * that is absent (empty field, or a value that is not a valid ISO date)
 * leaves the relative date unresolved.
 */
export function resolveActionDate(
	date: ActionSuggestionDate,
	anchorDates: ReadonlyMap<string, IsoDate>
): ResolvedActionDate {
	if (date.kind === 'NONE') return { status: 'NONE' };

	const concrete = date.relative
		? calculateRelativeDate(date.relative, anchorDates)
		: date.value && isIsoDate(date.value)
			? date.value
			: null;
	if (!concrete) return { status: 'UNRESOLVED', kind: date.kind };

	if (date.kind === 'AVAILABLE_FROM' || date.kind === 'APPROXIMATE') {
		return { status: 'INFORMATIONAL', kind: date.kind, date: concrete };
	}
	return { status: 'DUE', kind: date.kind, date: concrete };
}

function calculateRelativeDate(
	relative: ActionRelativeDate,
	anchorDates: ReadonlyMap<string, IsoDate>
): IsoDate | null {
	// A document anchor carries its own explicit date; a field anchor is looked up.
	const anchor = relative.anchorFieldKey
		? anchorDates.get(relative.anchorFieldKey)
		: (relative.anchorDate ?? undefined);
	if (!anchor || !isIsoDate(anchor)) return null;
	const signed = relative.relation === 'BEFORE' ? -relative.amount : relative.amount;
	const offset: Offset = { [OFFSET_KEY[relative.unit]]: signed };
	return applyOffset(anchor, offset);
}
