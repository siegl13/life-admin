import { afterEach, describe, expect, it } from 'vitest';
import {
	formatCurrencyDisplay,
	formatDueDayCount,
	formatRelativeDue,
	formatRelativeTime
} from './format';
import { setLocaleProvider, t } from '$lib/i18n';

afterEach(() => setLocaleProvider(() => 'de'));

describe('formatCurrencyDisplay', () => {
	it('renders a stored EUR value in German locale format', () => {
		expect(formatCurrencyDisplay('351.00 EUR')).toBe('351,00 €');
	});

	it('renders a stored USD value with its own symbol', () => {
		expect(formatCurrencyDisplay('10.00 USD')).toBe('10,00 $');
	});

	it('returns the raw string unchanged when it is not a valid stored currency value', () => {
		expect(formatCurrencyDisplay('not a currency value')).toBe('not a currency value');
	});
});

describe('formatRelativeDue', () => {
	const today = '2026-06-15';

	it('returns null for an undated action', () => {
		expect(formatRelativeDue(null, today)).toBeNull();
	});

	it('labels today, tomorrow and yesterday by name', () => {
		expect(formatRelativeDue('2026-06-15', today)).toBe('Heute');
		expect(formatRelativeDue('2026-06-16', today)).toBe('Morgen');
		expect(formatRelativeDue('2026-06-14', today)).toBe('Gestern');
	});

	it('counts days for a future date, including across a month boundary', () => {
		expect(formatRelativeDue('2026-06-20', today)).toBe('In 5 Tagen');
		expect(formatRelativeDue('2026-07-01', today)).toBe('In 16 Tagen');
	});

	it('counts days overdue, including across a year boundary', () => {
		expect(formatRelativeDue('2026-06-10', today)).toBe('5 Tage überfällig');
		expect(formatRelativeDue('2025-12-31', '2026-01-02')).toBe('2 Tage überfällig');
	});
});

describe('formatDueDayCount', () => {
	it.each([
		{ days: 0, expected: '0 Tage übrig' },
		{ days: 1, expected: '1 Tag übrig' },
		{ days: 2, expected: '2 Tage übrig' },
		{ days: -1, expected: '1 Tag überfällig' },
		{ days: -2, expected: '2 Tage überfällig' }
	])('formats German numeric day distance $days', ({ days, expected }) => {
		setLocaleProvider(() => 'de');
		expect(formatDueDayCount(shiftDate('2026-06-15', days), '2026-06-15')).toBe(expected);
	});

	it.each([
		{ days: 0, expected: '0 days left' },
		{ days: 1, expected: '1 day left' },
		{ days: 2, expected: '2 days left' },
		{ days: -1, expected: '1 day overdue' },
		{ days: -2, expected: '2 days overdue' }
	])('formats English numeric day distance $days', ({ days, expected }) => {
		setLocaleProvider(() => 'en');
		expect(formatDueDayCount(shiftDate('2026-06-15', days), '2026-06-15')).toBe(expected);
	});
});

describe('formatRelativeTime', () => {
	afterEach(() => setLocaleProvider(() => 'de'));

	const now = '2026-06-15T12:00:00.000Z';

	function minutesBefore(minutes: number): string {
		return new Date(Date.parse(now) - minutes * 60_000).toISOString();
	}

	function hoursBefore(hours: number): string {
		return minutesBefore(hours * 60);
	}

	it('reports just now for under a minute', () => {
		setLocaleProvider(() => 'de');
		expect(formatRelativeTime(minutesBefore(0), now)).toBe('gerade eben');
		setLocaleProvider(() => 'en');
		expect(formatRelativeTime(minutesBefore(0), now)).toBe('just now');
	});

	it('stays in minutes at 59 and switches to hours at 60', () => {
		setLocaleProvider(() => 'de');
		expect(formatRelativeTime(minutesBefore(1), now)).toBe('vor 1 Minute');
		expect(formatRelativeTime(minutesBefore(59), now)).toBe('vor 59 Minuten');
		expect(formatRelativeTime(minutesBefore(60), now)).toBe('vor 1 Stunde');

		setLocaleProvider(() => 'en');
		expect(formatRelativeTime(minutesBefore(1), now)).toBe('1 minute ago');
		expect(formatRelativeTime(minutesBefore(59), now)).toBe('59 minutes ago');
		expect(formatRelativeTime(minutesBefore(60), now)).toBe('1 hour ago');
	});

	it('stays in hours at 23 and switches to days at 24', () => {
		setLocaleProvider(() => 'de');
		expect(formatRelativeTime(hoursBefore(23), now)).toBe('vor 23 Stunden');
		expect(formatRelativeTime(hoursBefore(24), now)).toBe('vor 1 Tag');

		setLocaleProvider(() => 'en');
		expect(formatRelativeTime(hoursBefore(23), now)).toBe('23 hours ago');
		expect(formatRelativeTime(hoursBefore(24), now)).toBe('1 day ago');
	});

	it('stays in days up to 6 and falls back to the exact date at 7 full days', () => {
		setLocaleProvider(() => 'de');
		expect(formatRelativeTime(hoursBefore(6 * 24), now)).toBe('vor 6 Tagen');
		expect(formatRelativeTime(hoursBefore(7 * 24), now)).toBe('8. Juni 2026');

		setLocaleProvider(() => 'en');
		expect(formatRelativeTime(hoursBefore(6 * 24), now)).toBe('6 days ago');
		expect(formatRelativeTime(hoursBefore(7 * 24), now)).toBe('8. Juni 2026');
	});
});

function shiftDate(iso: string, days: number): string {
	const date = new Date(`${iso}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

describe("What's next exact due date text", () => {
	it('shows only the exact date or No date, without a repeated state prefix', () => {
		expect(t('due.noDate')).toBe('Ohne Datum');
		expect(t('due.noDateAnytime')).toBe('Ohne Datum');
	});
});
