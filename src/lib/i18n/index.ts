import { de, type TranslationKey } from './de';
import { en } from './en';

export type Locale = 'de' | 'en';

const catalogs: Record<Locale, Record<TranslationKey, string>> = { de, en };

/**
 * The active locale is supplied by the runtime: request-scoped storage on
 * the server (`$lib/server/i18n/requestLocale`, wired once by
 * `hooks.server.ts`), and a reactive client-side value wired once by the
 * root layout after hydration. Falls back to German — the prior fixed V1
 * locale — when nothing has wired a provider yet (e.g. a unit test that
 * imports `t`/`resolveLabel` directly without going through a request).
 */
let localeProvider: () => Locale = () => 'de';

export function setLocaleProvider(provider: () => Locale): void {
	localeProvider = provider;
}

export function getCurrentLocale(): Locale {
	return localeProvider();
}

/**
 * `params` substitutes `{name}` placeholders with plain data (e.g. an
 * event or action label from the materialized playbook) — never with
 * another translation key, so wording stays swappable per locale while
 * the surrounding sentence structure does not leak into TypeScript.
 */
export function t(key: TranslationKey, params?: Record<string, string>): string {
	const template = catalogs[getCurrentLocale()][key];
	if (!params) return template;
	return Object.entries(params).reduce(
		(text, [name, value]) => text.replaceAll(`{${name}}`, value),
		template
	);
}

/**
 * Resolves a playbook-authored label for the current UI locale. Playbook
 * labels are authored in English as the base, with an optional
 * `label_i18n` map for other locales (bundled de-DE playbooks always
 * provide `de`). Falls back to the base label if no translation exists
 * for the current locale, never to an empty string.
 */
export function resolveLabel(base: string, labelI18n: Record<string, string>): string {
	return labelI18n[getCurrentLocale()] || base;
}
