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
