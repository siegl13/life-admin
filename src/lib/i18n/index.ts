import { de, type TranslationKey } from './de';
import { en } from './en';

export type Locale = 'de' | 'en';

const catalogs: Record<Locale, Record<TranslationKey, string>> = { de, en };

/**
 * V1 ships a single, fixed UI locale (German). This constant is the only
 * place that would need to change to read from a user setting later —
 * every call site already goes through {@link t} / {@link resolveLabel}.
 */
export const currentLocale: Locale = 'de';

/**
 * `params` substitutes `{name}` placeholders with plain data (e.g. an
 * event or action label from the materialized playbook) — never with
 * another translation key, so wording stays swappable per locale while
 * the surrounding sentence structure does not leak into TypeScript.
 */
export function t(key: TranslationKey, params?: Record<string, string>): string {
	const template = catalogs[currentLocale][key];
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
	return labelI18n[currentLocale] || base;
}
