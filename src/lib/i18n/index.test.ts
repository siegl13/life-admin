import { afterEach, describe, expect, it } from 'vitest';
import { setLocaleProvider, t, type Locale } from './index';

describe('accepted suggestion history translations', () => {
	afterEach(() => setLocaleProvider(() => 'de'));

	it.each([
		{ locale: 'en', one: '1 suggestion accepted', many: '4 suggestions accepted' },
		{ locale: 'de', one: '1 Vorschlag übernommen', many: '4 Vorschläge übernommen' }
	] satisfies { locale: Locale; one: string; many: string }[])(
		'formats singular and plural counts in $locale',
		({ locale, one, many }) => {
			setLocaleProvider(() => locale);

			expect(t('items.detail.historyAiSuggestionsAcceptedOne', { count: '1' })).toBe(one);
			expect(t('items.detail.historyAiSuggestionsAcceptedMany', { count: '4' })).toBe(many);
			expect(one).not.toMatch(/\{[^}]*plural/);
			expect(many).not.toMatch(/\{[^}]*plural/);
		}
	);
});

describe('inbox minute and document count translations', () => {
	afterEach(() => setLocaleProvider(() => 'de'));

	it.each([
		{ locale: 'en', one: '1 minute ago', many: '4 minutes ago' },
		{ locale: 'de', one: 'vor 1 Minute', many: 'vor 4 Minuten' }
	] satisfies { locale: Locale; one: string; many: string }[])(
		'formats singular and plural minute counts in $locale',
		({ locale, one, many }) => {
			setLocaleProvider(() => locale);
			expect(t('inbox.minutesAgoOne', { minutes: '1' })).toBe(one);
			expect(t('inbox.minutesAgoMany', { minutes: '4' })).toBe(many);
		}
	);

	it.each([
		{ locale: 'en', one: '1 document in the inbox', many: '4 documents in the inbox' },
		{ locale: 'de', one: '1 Dokument im Eingang', many: '4 Dokumente im Eingang' }
	] satisfies { locale: Locale; one: string; many: string }[])(
		'formats singular and plural document counts in $locale',
		({ locale, one, many }) => {
			setLocaleProvider(() => locale);
			expect(t('inbox.countOne', { count: '1' })).toBe(one);
			expect(t('inbox.countMany', { count: '4' })).toBe(many);
		}
	);
});
