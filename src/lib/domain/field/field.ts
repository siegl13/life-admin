import type { IsoDate } from '../date/isoDate';

export type FieldType = 'text' | 'date' | 'currency';

/**
 * Where a field on a cycle came from. PLAYBOOK fields are materialized at
 * item-creation time from the playbook snapshot and can never be removed.
 * CUSTOM fields are added by the user later and can be removed again
 * (see docs/adr/0004 and Slice 2 acceptance criteria).
 */
export type FieldOrigin = 'PLAYBOOK' | 'CUSTOM';

/**
 * A Field is a single piece of recommended or user-entered data on a
 * Cycle: a text value or a calendar date. Only the Item title is ever
 * mandatory; a field being `recommended` never makes it required to save.
 */
export interface Field {
	id: string;
	cycleId: string;
	fieldKey: string;
	label: string;
	type: FieldType;
	origin: FieldOrigin;
	recommended: boolean;
	position: number;
	value: string | IsoDate | null;
}

/**
 * A `currency` field's value is a decimal amount plus an ISO 4217 code.
 * There is no separate storage column for it: the canonical serialized
 * form (`"<amount> <CODE>"`, exactly two fraction digits, a single space)
 * is what `Field.value` holds for a currency field, the same one TEXT
 * column every other field type already uses — see docs/adr/0012.
 *
 * The amount is always handled as a decimal STRING, never a float:
 * `formatCurrencyStorageValue` builds it with string padding only
 * (no `Number()`/`toFixed()`), so an exact value can never pick up
 * floating-point rounding on its way into storage. Converting to a
 * `Number` is fine, and only ever done, for presentation (see
 * `$lib/ui/format.ts`'s `formatCurrencyDisplay`).
 */
export interface CurrencyValue {
	/** Decimal string, always exactly two fraction digits (e.g. "351.00"). Never negative. */
	amount: string;
	/** ISO 4217, three uppercase letters (e.g. "EUR"). */
	currencyCode: string;
}

const CURRENCY_AMOUNT_INPUT_PATTERN = /^\d{1,15}(?:\.\d{1,2})?$/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const CURRENCY_STORAGE_PATTERN = /^(\d{1,15}\.\d{2}) ([A-Z]{3})$/;

/**
 * Builds the canonical stored string from a raw amount (as typed by a
 * user, or as suggested by the AI provider) and a currency code. Returns
 * `null` when either half is not well-formed, so the caller can reject
 * the update instead of silently storing something malformed. Pure
 * string manipulation: the amount is zero-padded to two fraction digits
 * without ever going through `Number`.
 */
export function formatCurrencyStorageValue(
	rawAmount: string,
	rawCurrencyCode: string
): string | null {
	const amount = rawAmount.trim();
	const code = rawCurrencyCode.trim().toUpperCase();
	if (!CURRENCY_AMOUNT_INPUT_PATTERN.test(amount) || !CURRENCY_CODE_PATTERN.test(code)) {
		return null;
	}
	const [wholePart, fractionPart = ''] = amount.split('.');
	const paddedFraction = (fractionPart + '00').slice(0, 2);
	return `${wholePart}.${paddedFraction} ${code}`;
}

/** Parses a canonical stored currency string back into its two parts. */
export function parseCurrencyStorageValue(raw: string): CurrencyValue | null {
	const match = CURRENCY_STORAGE_PATTERN.exec(raw.trim());
	if (!match) return null;
	return { amount: match[1], currencyCode: match[2] };
}

export function isValidCurrencyStorageValue(raw: string): boolean {
	return CURRENCY_STORAGE_PATTERN.test(raw.trim());
}

/**
 * A small, curated set for the currency-code selector (UI and AI
 * suggestion validation both use this list, so an offered code is always
 * one the model was also allowed to suggest). Not a currency database —
 * just the codes worth supporting for V1's German-locale, EUR-centric use
 * case, per the roadmap's own "prefer a small selector, no currency
 * database" instruction.
 */
export const SUPPORTED_CURRENCY_CODES = ['EUR', 'USD', 'GBP', 'CHF'] as const;
