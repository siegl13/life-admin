import { describe, expect, it } from 'vitest';
import { resolveEffectiveLocale } from './resolveLocale';

describe('resolveEffectiveLocale', () => {
	it('resolves German for a plain German browser preference', () => {
		expect(resolveEffectiveLocale('browser', 'de-DE,de;q=0.9,en;q=0.8')).toBe('de');
	});

	it('resolves English for a plain English browser preference', () => {
		expect(resolveEffectiveLocale('browser', 'en-US,en;q=0.9')).toBe('en');
	});

	it('picks the first supported language among several ordered preferences', () => {
		expect(resolveEffectiveLocale('browser', 'fr-FR,fr;q=0.9,de;q=0.8')).toBe('de');
	});

	it('falls back to English when no preference is supported', () => {
		expect(resolveEffectiveLocale('browser', 'fr-FR,fr;q=0.9')).toBe('en');
	});

	it('falls back to English when the header is missing', () => {
		expect(resolveEffectiveLocale('browser', null)).toBe('en');
	});

	it('falls back to English when the header is empty', () => {
		expect(resolveEffectiveLocale('browser', '')).toBe('en');
	});

	it('an explicit "de" setting overrides an English browser preference', () => {
		expect(resolveEffectiveLocale('de', 'en-US,en;q=0.9')).toBe('de');
	});

	it('an explicit "en" setting overrides a German browser preference', () => {
		expect(resolveEffectiveLocale('en', 'de-DE,de;q=0.9')).toBe('en');
	});

	it('switching back to "browser" uses the current browser preference again', () => {
		const header = 'de-DE,de;q=0.9,en;q=0.8';
		expect(resolveEffectiveLocale('de', header)).toBe('de');
		expect(resolveEffectiveLocale('browser', header)).toBe('de');
	});
});
