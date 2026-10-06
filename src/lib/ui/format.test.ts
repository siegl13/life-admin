import { describe, expect, it } from 'vitest';
import { formatCurrencyDisplay, formatRelativeDue } from './format';
import { t } from '$lib/i18n';

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

describe("What's next exact due date text", () => {
	it('shows only the exact date or No date, without a repeated state prefix', () => {
		expect(t('due.noDate')).toBe('Ohne Datum');
		expect(t('due.noDateAnytime')).toBe('Ohne Datum');
	});
});
