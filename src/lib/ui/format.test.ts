import { describe, expect, it } from 'vitest';
import { formatCurrencyDisplay } from './format';

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
