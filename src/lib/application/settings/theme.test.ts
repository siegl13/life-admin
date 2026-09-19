import { describe, expect, it, vi } from 'vitest';
import { InvalidThemePreferenceError, getThemePreference, setThemePreference } from './theme';

function fakeSettings(store: Record<string, string> = {}) {
	return {
		get: vi.fn((key: string) => store[key] ?? null),
		set: vi.fn((key: string, value: string) => {
			store[key] = value;
		})
	};
}

describe('getThemePreference', () => {
	it('reads as "system" on a fresh install with no ui.theme row', () => {
		const settings = fakeSettings();
		expect(getThemePreference({ settings })).toBe('system');
	});

	it.each(['light', 'dark', 'system'] as const)('reads a stored %s preference', (value) => {
		const settings = fakeSettings({ 'ui.theme': value });
		expect(getThemePreference({ settings })).toBe(value);
	});

	it('falls back to "system" for an unrecognized stored value', () => {
		const settings = fakeSettings({ 'ui.theme': 'sepia' });
		expect(getThemePreference({ settings })).toBe('system');
	});
});

describe('setThemePreference', () => {
	it.each(['light', 'dark', 'system'])('stores a valid preference (%s)', (value) => {
		const settings = fakeSettings();
		setThemePreference({ settings }, value);
		expect(settings.set).toHaveBeenCalledWith('ui.theme', value);
	});

	it('rejects an unrecognized preference', () => {
		const settings = fakeSettings();
		expect(() => setThemePreference({ settings }, 'sepia')).toThrow(InvalidThemePreferenceError);
		expect(settings.set).not.toHaveBeenCalled();
	});
});
