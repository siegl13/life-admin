import type { AppSettingsPort } from '$lib/application/ai/ports';
import type { LanguagePreference } from '$lib/domain/i18n/resolveLocale';

export type { LanguagePreference };

const KEY_LANGUAGE = 'ui.language';

const VALID: ReadonlySet<string> = new Set(['browser', 'de', 'en']);

/** Absent or unrecognized means "browser": an invalid stored value never
 *  crashes resolution, it just behaves as if no explicit override existed. */
export function getLanguagePreference(ports: { settings: AppSettingsPort }): LanguagePreference {
	const raw = ports.settings.get(KEY_LANGUAGE);
	return raw && VALID.has(raw) ? (raw as LanguagePreference) : 'browser';
}

export class InvalidLanguagePreferenceError extends Error {}

export function setLanguagePreference(
	ports: { settings: AppSettingsPort },
	preference: string
): void {
	if (!VALID.has(preference)) throw new InvalidLanguagePreferenceError();
	ports.settings.set(KEY_LANGUAGE, preference);
}
