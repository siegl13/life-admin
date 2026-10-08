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

function diffCalendarDays(fromIso: IsoDate, toIso: IsoDate): number {
	const [fy, fm, fd] = fromIso.split('-').map(Number);
	const [ty, tm, td] = toIso.split('-').map(Number);
	const fromUtc = Date.UTC(fy, fm - 1, fd);
	const toUtc = Date.UTC(ty, tm - 1, td);
	return Math.round((toUtc - fromUtc) / 86_400_000);
}

/**
 * A short, additional "today / tomorrow / in N days" pill alongside the
 * exact date `formatDue` already renders — never a replacement for it, so
 * the full readable state and exact date stay available regardless of
 * this value. `null` for an undated action: there is no distance to
 * express. Calendar-date arithmetic only (UTC, matching `formatDate`),
 * and `todayIso` always comes from the server clock, never the browser's
 * wall clock, so server-rendered and hydrated output agree.
 */
export function formatRelativeDue(dueDate: IsoDate | null, todayIso: IsoDate): string | null {
	if (dueDate === null) return null;
	const diff = diffCalendarDays(todayIso, dueDate);
	if (diff === 0) return t('due.relative.today');
	if (diff === 1) return t('due.relative.tomorrow');
	if (diff === -1) return t('due.relative.yesterday');
	if (diff > 1) return t('due.relative.inDays', { count: String(diff) });
	return t('due.relative.overdueByDays', { count: String(-diff) });
}

/**
 * Shared relative-time presentation for an observed instant (Inbox upload,
 * Settings notification activity): just now / minutes / hours / days, then
 * the exact date formatter from day 7 on. Both `observedIso` and `nowIso`
 * are explicit inputs — this never reads `Date.now()` — so a server route
 * can compute `now` once and every relative-time render on that page
 * (server and hydrated client alike) agrees.
 */
export function formatRelativeTime(observedIso: string, nowIso: string): string {
	const diffMinutes = Math.max(
		0,
		Math.floor((Date.parse(nowIso) - Date.parse(observedIso)) / 60_000)
	);
	if (diffMinutes < 1) return t('relativeTime.justNow');
	if (diffMinutes < 60) {
		return t(diffMinutes === 1 ? 'relativeTime.minutesOne' : 'relativeTime.minutesMany', {
			count: String(diffMinutes)
		});
	}
	const diffHours = Math.floor(diffMinutes / 60);
	if (diffHours < 24) {
		return t(diffHours === 1 ? 'relativeTime.hoursOne' : 'relativeTime.hoursMany', {
			count: String(diffHours)
		});
	}
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) {
		return t(diffDays === 1 ? 'relativeTime.daysOne' : 'relativeTime.daysMany', {
			count: String(diffDays)
		});
	}
	return formatDate(observedIso.slice(0, 10));
}

/** Numeric day distance for the Item detail hero. Unlike the short pill,
 *  this keeps the number visible for today and tomorrow too. */
export function formatDueDayCount(dueDate: IsoDate, todayIso: IsoDate): string {
	const diff = diffCalendarDays(todayIso, dueDate);
	if (diff < 0) {
		const count = -diff;
		return t(count === 1 ? 'items.detail.daysOverdueOne' : 'items.detail.daysOverdueMany', {
			count: String(count)
		});
	}
	return t(diff === 1 ? 'items.detail.daysLeftOne' : 'items.detail.daysLeftMany', {
		count: String(diff)
	});
}
