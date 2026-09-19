import type { AppSettingsPort } from '$lib/application/ai/ports';

const KEY_THEME = 'ui.theme';

export type ThemePreference = 'light' | 'dark' | 'system';

const VALID: ReadonlySet<string> = new Set(['light', 'dark', 'system']);

/** Absent means "system": a fresh install follows the OS/browser setting
 *  (`prefers-color-scheme`), not a third stored value that needs its own
 *  handling. */
export function getThemePreference(ports: { settings: AppSettingsPort }): ThemePreference {
	const raw = ports.settings.get(KEY_THEME);
	return raw && VALID.has(raw) ? (raw as ThemePreference) : 'system';
}

export class InvalidThemePreferenceError extends Error {}

export function setThemePreference(ports: { settings: AppSettingsPort }, preference: string): void {
	if (!VALID.has(preference)) throw new InvalidThemePreferenceError();
	ports.settings.set(KEY_THEME, preference);
}
