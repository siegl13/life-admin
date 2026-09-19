import { addDays, addMonths, addWeeks, addYears, format, isValid, parse } from 'date-fns';
import type { Offset } from './offset';

/**
 * Date-only value in the format YYYY-MM-DD. Represents a calendar date
 * (a contract end date, an inspection due date, ...), never a moment in
 * time. No timezone conversion is ever applied to a value of this type.
 */
export type IsoDate = string;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
	if (!ISO_DATE_PATTERN.test(value)) return false;
	const parsed = parse(value, 'yyyy-MM-dd', new Date(2000, 0, 1));
	return isValid(parsed) && format(parsed, 'yyyy-MM-dd') === value;
}

/**
 * Parses an ISO date-only string into a local midnight Date usable with
 * date-fns arithmetic. Throws on malformed input; callers at the
 * boundary (Zod schemas, form validation) are expected to have already
 * validated the string with {@link isIsoDate}.
 */
export function parseIsoDate(value: IsoDate): Date {
	if (!isIsoDate(value)) {
		throw new Error(`Not a valid ISO date (YYYY-MM-DD): ${value}`);
	}
	return parse(value, 'yyyy-MM-dd', new Date(2000, 0, 1));
}

export function formatIsoDate(date: Date): IsoDate {
	return format(date, 'yyyy-MM-dd');
}

export function today(): IsoDate {
	return formatIsoDate(new Date());
}

export function compareIsoDate(a: IsoDate, b: IsoDate): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

export function isBeforeToday(date: IsoDate, todayIso: IsoDate): boolean {
	return compareIsoDate(date, todayIso) < 0;
}

/**
 * Applies a calendar-aware offset to an ISO date. Components are applied
 * in a fixed order (years, then months, then weeks, then days) so that
 * results are deterministic regardless of how the offset was authored.
 *
 * Month/year arithmetic clamps to the last valid day of the resulting
 * month (date-fns default): 2026-01-31 with { months: 1 } yields
 * 2026-02-28, not 2026-03-03.
 */
export function applyOffset(date: IsoDate, offset: Offset): IsoDate {
	let result = parseIsoDate(date);
	if (offset.years) result = addYears(result, offset.years);
	if (offset.months) result = addMonths(result, offset.months);
	if (offset.weeks) result = addWeeks(result, offset.weeks);
	if (offset.days) result = addDays(result, offset.days);
	return formatIsoDate(result);
}
