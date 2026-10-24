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

describe('document source history translations', () => {
	afterEach(() => setLocaleProvider(() => 'de'));

	it.each([
		{
			locale: 'de',
			named: ['1 Vorschlag aus „Police“ übernommen', '4 Vorschläge aus „Police“ übernommen'],
			generic: [
				'1 Vorschlag aus einem Dokument übernommen',
				'4 Vorschläge aus einem Dokument übernommen'
			]
		},
		{
			locale: 'en',
			named: ['1 suggestion accepted from “Police”', '4 suggestions accepted from “Police”'],
			generic: ['1 suggestion accepted from a document', '4 suggestions accepted from a document']
		}
	] satisfies { locale: Locale; named: string[]; generic: string[] }[])(
		'formats singular and plural counts in $locale',
		({ locale, named, generic }) => {
			setLocaleProvider(() => locale);

			expect(
				t('items.detail.historyAiSuggestionsFromNamedDocumentOne', {
					count: '1',
					document: 'Police'
				})
			).toBe(named[0]);
			expect(
				t('items.detail.historyAiSuggestionsFromNamedDocumentMany', {
					count: '4',
					document: 'Police'
				})
			).toBe(named[1]);
			expect(t('items.detail.historyAiSuggestionsFromDocumentOne', { count: '1' })).toBe(
				generic[0]
			);
			expect(t('items.detail.historyAiSuggestionsFromDocumentMany', { count: '4' })).toBe(
				generic[1]
			);
		}
	);
});

describe('inbox document count translations', () => {
	afterEach(() => setLocaleProvider(() => 'de'));

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
