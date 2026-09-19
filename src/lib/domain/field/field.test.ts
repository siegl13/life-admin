import { describe, expect, it } from 'vitest';
import {
	formatCurrencyStorageValue,
	isValidCurrencyStorageValue,
	parseCurrencyStorageValue
} from './field';

describe('formatCurrencyStorageValue', () => {
	it('pads a whole amount to two fraction digits', () => {
		expect(formatCurrencyStorageValue('351', 'eur')).toBe('351.00 EUR');
	});

	it('pads a single fraction digit to two', () => {
		expect(formatCurrencyStorageValue('351.5', 'EUR')).toBe('351.50 EUR');
	});

	it('preserves an already-exact two-fraction-digit amount unchanged (no float rounding)', () => {
		// A value chosen specifically because Number(x).toFixed(2) style
		// rounding is a classic float trap for amounts like this.
		expect(formatCurrencyStorageValue('6740.66', 'EUR')).toBe('6740.66 EUR');
		expect(formatCurrencyStorageValue('0.10', 'EUR')).toBe('0.10 EUR');
	});

	it('uppercases a lowercase currency code', () => {
		expect(formatCurrencyStorageValue('10.00', 'usd')).toBe('10.00 USD');
	});

	it('rejects a negative amount', () => {
		expect(formatCurrencyStorageValue('-10.00', 'EUR')).toBeNull();
	});

	it('rejects more than two fraction digits', () => {
		expect(formatCurrencyStorageValue('10.001', 'EUR')).toBeNull();
	});

	it('rejects a non-decimal amount', () => {
		expect(formatCurrencyStorageValue('abc', 'EUR')).toBeNull();
	});

	it('rejects a currency code that is not exactly three letters', () => {
		expect(formatCurrencyStorageValue('10.00', 'EU')).toBeNull();
		expect(formatCurrencyStorageValue('10.00', 'EURO')).toBeNull();
		expect(formatCurrencyStorageValue('10.00', '')).toBeNull();
	});
});

describe('parseCurrencyStorageValue / isValidCurrencyStorageValue', () => {
	it('round-trips a value built by formatCurrencyStorageValue', () => {
		const stored = formatCurrencyStorageValue('351.00', 'EUR')!;
		expect(parseCurrencyStorageValue(stored)).toEqual({ amount: '351.00', currencyCode: 'EUR' });
		expect(isValidCurrencyStorageValue(stored)).toBe(true);
	});

	it('rejects a value with a currency symbol instead of a code', () => {
		expect(parseCurrencyStorageValue('351,00 €')).toBeNull();
		expect(isValidCurrencyStorageValue('351,00 €')).toBe(false);
	});

	it('rejects a value missing the fraction digits', () => {
		expect(parseCurrencyStorageValue('351 EUR')).toBeNull();
	});
});
