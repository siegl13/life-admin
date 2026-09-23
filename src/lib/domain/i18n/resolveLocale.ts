import type { Locale } from '$lib/i18n';

export type LanguagePreference = 'browser' | 'de' | 'en';

const SUPPORTED: readonly Locale[] = ['de', 'en'];

/**
 * Parses an `Accept-Language` header into the first supported language by
 * descending q-value preference. Falls back to English when the header is
 * missing, malformed, or names no supported language — this app supports
 * exactly `de`/`en`, never a third negotiated locale.
 */
function detectBrowserLocale(acceptLanguageHeader: string | null): Locale {
	if (!acceptLanguageHeader) return 'en';
	const ranked = acceptLanguageHeader
		.split(',')
		.map((part) => {
			const [tag, qPart] = part.trim().split(';q=');
			return { tag: tag?.trim().toLowerCase() ?? '', q: qPart ? Number(qPart) : 1 };
		})
		.filter((entry) => entry.tag !== '' && !Number.isNaN(entry.q))
		.sort((a, b) => b.q - a.q);
	for (const { tag } of ranked) {
		const base = tag.split('-')[0];
		const match = SUPPORTED.find((locale) => locale === base);
		if (match) return match;
	}
	return 'en';
}

/**
 * Applies the language-selection precedence: an explicit `de`/`en`
 * application setting always wins; `browser` defers to the request's
 * `Accept-Language` preferences, with an English fallback.
 */
export function resolveEffectiveLocale(
	preference: LanguagePreference,
	acceptLanguageHeader: string | null
): Locale {
	if (preference === 'de' || preference === 'en') return preference;
	return detectBrowserLocale(acceptLanguageHeader);
}
