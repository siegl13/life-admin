import type { IsoDate } from '$lib/domain/date/isoDate';
import { parseCurrencyStorageValue } from '$lib/domain/field/field';
import { t } from '$lib/i18n';

/**
 * Presentation-only date helpers. No domain rules live here: the What's
 * Next bucket (and, on the detail page, the action state/availability)
 * already decides *what* a date means — these functions only decide how
 * it reads in German.
 *
 * Dates are formatted in UTC so server-rendered and hydrated output are
 * identical regardless of the visitor's timezone.
 */
const dateFormat = new Intl.DateTimeFormat('de-DE', {
	day: 'numeric',
	month: 'long',
	year: 'numeric',
	timeZone: 'UTC'
});

export function formatDate(iso: IsoDate | string): string {
	const [year, month, day] = iso.split('-').map(Number);
	if (!year || !month || !day) return iso;
	return dateFormat.format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * The full, screen-reader-friendly due text for an action row. The state
 * word is always present, so urgency never depends on colour alone.
 */
/**
 * Presentation-only: the canonical stored string ("351.00 EUR") formatted
 * for the app locale ("351,00 €"). Converting the decimal amount to a
 * `Number` here is safe precisely because this is display-only — nothing
 * downstream of this function is ever persisted (see the exact-decimal
 * storage rule in `$lib/domain/field/field.ts`). An unparsable value is
 * returned unchanged rather than thrown, matching `formatDate`.
 */
export function formatCurrencyDisplay(raw: string): string {
	const parsed = parseCurrencyStorageValue(raw);
	if (!parsed) return raw;
	try {
		return new Intl.NumberFormat('de-DE', {
			style: 'currency',
			currency: parsed.currencyCode
		}).format(Number(parsed.amount));
	} catch {
		return raw;
	}
}

export function formatDue(bucket: 0 | 1 | 2, dueDate: IsoDate | null): string {
	if (bucket === 0 && dueDate) return t('due.overdueSince', { date: formatDate(dueDate) });
	if (bucket === 1) return t('due.noDateAnytime');
	if (dueDate) return t('due.dueOn', { date: formatDate(dueDate) });
	return t('due.noDate');
}
