import { describe, expect, it, vi } from 'vitest';
import {
	InvalidLanguagePreferenceError,
	getLanguagePreference,
	setLanguagePreference
} from './language';

function fakeSettings(store: Record<string, string> = {}) {
	return {
		get: vi.fn((key: string) => store[key] ?? null),
		set: vi.fn((key: string, value: string) => {
			store[key] = value;
		})
	};
}

describe('getLanguagePreference', () => {
	it('reads as "browser" on a fresh install with no ui.language row', () => {
		const settings = fakeSettings();
		expect(getLanguagePreference({ settings })).toBe('browser');
	});

	it.each(['browser', 'de', 'en'] as const)('reads a stored %s preference', (value) => {
		const settings = fakeSettings({ 'ui.language': value });
		expect(getLanguagePreference({ settings })).toBe(value);
	});

	it('falls back to "browser" for an unrecognized stored value', () => {
		const settings = fakeSettings({ 'ui.language': 'fr' });
		expect(getLanguagePreference({ settings })).toBe('browser');
	});
});

describe('setLanguagePreference', () => {
	it.each(['browser', 'de', 'en'])('stores a valid preference (%s)', (value) => {
		const settings = fakeSettings();
		setLanguagePreference({ settings }, value);
		expect(settings.set).toHaveBeenCalledWith('ui.language', value);
	});

	it('rejects an unrecognized preference', () => {
		const settings = fakeSettings();
		expect(() => setLanguagePreference({ settings }, 'fr')).toThrow(InvalidLanguagePreferenceError);
		expect(settings.set).not.toHaveBeenCalled();
	});
});
