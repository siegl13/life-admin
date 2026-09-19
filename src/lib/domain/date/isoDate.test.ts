import { describe, expect, it } from 'vitest';
import { applyOffset, compareIsoDate, isBeforeToday, isIsoDate } from './isoDate';

describe('isIsoDate', () => {
	it('accepts a well-formed date', () => {
		expect(isIsoDate('2026-09-06')).toBe(true);
	});

	it('rejects malformed strings', () => {
		expect(isIsoDate('2026-9-6')).toBe(false);
		expect(isIsoDate('09-06-2026')).toBe(false);
		expect(isIsoDate('not-a-date')).toBe(false);
		expect(isIsoDate('')).toBe(false);
	});

	it('rejects calendar-invalid dates (no silent rollover)', () => {
		expect(isIsoDate('2026-02-30')).toBe(false);
		expect(isIsoDate('2026-13-01')).toBe(false);
		expect(isIsoDate('2026-00-10')).toBe(false);
	});

	it('accepts a leap day only in a leap year', () => {
		expect(isIsoDate('2024-02-29')).toBe(true);
		expect(isIsoDate('2026-02-29')).toBe(false);
	});
});

describe('applyOffset', () => {
	it('applies a month offset with calendar-aware clamping', () => {
		// 2026-01-31 + 1 month has no Feb 31 => clamps to Feb 28 (2026 is not a leap year)
		expect(applyOffset('2026-01-31', { months: 1 })).toBe('2026-02-28');
	});

	it('applies a negative month offset ("9 months before")', () => {
		expect(applyOffset('2028-08-31', { months: -9 })).toBe('2027-11-30');
	});

	it('applies a week offset', () => {
		expect(applyOffset('2026-09-06', { weeks: -2 })).toBe('2026-08-23');
	});

	it('applies a year offset across a leap day', () => {
		expect(applyOffset('2024-02-29', { years: 1 })).toBe('2025-02-28');
	});

	it('applies combined offsets in a fixed order (years, months, weeks, days)', () => {
		expect(applyOffset('2026-01-15', { years: 1, months: 1, weeks: 1, days: 1 })).toBe(
			'2027-02-23'
		);
	});

	it('returns the same date for a zero offset', () => {
		expect(applyOffset('2026-09-06', {})).toBe('2026-09-06');
	});

	it('throws on a malformed input date', () => {
		expect(() => applyOffset('not-a-date', { months: 1 })).toThrow();
	});
});

describe('compareIsoDate / isBeforeToday', () => {
	it('orders dates lexicographically (ISO sorts correctly as strings)', () => {
		expect(compareIsoDate('2026-01-01', '2026-01-02')).toBeLessThan(0);
		expect(compareIsoDate('2026-01-02', '2026-01-01')).toBeGreaterThan(0);
		expect(compareIsoDate('2026-01-01', '2026-01-01')).toBe(0);
	});

	it('flags a past date as before today', () => {
		expect(isBeforeToday('2020-01-01', '2026-09-06')).toBe(true);
		expect(isBeforeToday('2026-09-06', '2026-09-06')).toBe(false);
		expect(isBeforeToday('2030-01-01', '2026-09-06')).toBe(false);
	});
});
