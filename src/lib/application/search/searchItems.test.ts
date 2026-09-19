import { describe, expect, it } from 'vitest';
import { normalizeSearchQuery, searchItems } from './searchItems';

const base = {
	itemId: 'item-1',
	title: 'Born',
	playbookName: null,
	playbookSnapshot: null,
	fieldLabel: null,
	fieldType: null,
	value: null,
	actionId: null,
	actionLabel: null,
	sourceOrder: 0,
	moreMatches: 0,
	total: 1
} as const;

describe('searchItems', () => {
	it('normalizes Unicode whitespace and bounds the query by code point', () => {
		expect(normalizeSearchQuery('  E.ON\u00a0\u00a0ÄRGER  ')).toBe('e.on ärger');
		expect(Array.from(normalizeSearchQuery('x'.repeat(121))).length).toBe(120);
	});

	it('does not execute for fewer than two normalized code points', () => {
		let called = false;
		const result = searchItems(
			{
				search: {
					listActiveSources: () => {
						called = true;
						return [];
					}
				}
			},
			' x '
		);
		expect(result).toMatchObject({ query: 'x', total: 0, results: [] });
		expect(called).toBe(false);
	});

	it('uses source priority and reports additional allowed matches once per source', () => {
		const result = searchItems(
			{
				search: {
					listActiveSources: () => [
						{ ...base, sourceKind: 'TITLE' as const, moreMatches: 2 },
						{
							...base,
							sourceKind: 'FIELD' as const,
							fieldLabel: 'Kennzeichen',
							fieldType: 'text' as const,
							value: 'Born'
						},
						{ ...base, sourceKind: 'ACTION' as const, actionLabel: 'Born prüfen' }
					]
				}
			},
			'born'
		);
		expect(result.total).toBe(1);
		expect(result.results[0]).toMatchObject({
			title: 'Born',
			contextValue: null,
			moreMatches: 2,
			highlight: { target: 'title' }
		});
	});

	it('does not make the generic fallback type searchable', () => {
		const result = searchItems({ search: { listActiveSources: () => [] } }, 'ohne');
		expect(result.total).toBe(0);
	});

	it('matches localized dates and currencies while returning localized context', () => {
		const date = {
			...base,
			sourceKind: 'FIELD' as const,
			fieldLabel: 'Termin',
			fieldType: 'date' as const,
			value: '2026-09-14'
		};
		const currency = {
			...base,
			itemId: 'item-2',
			sourceKind: 'FIELD' as const,
			fieldLabel: 'Preis',
			fieldType: 'currency' as const,
			value: '351.00 EUR'
		};
		expect(
			searchItems({ search: { listActiveSources: () => [date] } }, '14. september').results[0]
		).toMatchObject({ contextValue: '14. September 2026', highlight: { target: 'context' } });
		expect(
			searchItems({ search: { listActiveSources: () => [currency] } }, '351,00').results[0]
		).toMatchObject({ contextValue: '351,00 €', highlight: { target: 'context' } });
	});

	it('keeps snippets within 160 code points and maps normalized characters to the original value', () => {
		const value = `${'a'.repeat(200)}ﬃ${'b'.repeat(200)}`;
		const result = searchItems(
			{
				search: {
					listActiveSources: () => [{ ...base, sourceKind: 'TITLE' as const, title: value }]
				}
			},
			'ffi'
		).results[0];
		expect(Array.from(result.title).length).toBeLessThanOrEqual(160);
		expect(result.title.startsWith('…')).toBe(true);
		expect(result.title.endsWith('…')).toBe(true);
		expect(result.highlight).toEqual({
			target: 'title',
			start: expect.any(Number),
			end: expect.any(Number)
		});
	});

	it('keeps repository-normalized whitespace and combining-sequence matches highlightable', () => {
		const rows = [
			{ ...base, sourceKind: 'TITLE' as const, title: 'Foo   Bar' },
			{ ...base, itemId: 'item-2', sourceKind: 'TITLE' as const, title: 'A\u030Aland' }
		];
		const whitespace = searchItems({ search: { listActiveSources: () => [rows[0]] } }, 'foo bar')
			.results[0];
		const combining = searchItems({ search: { listActiveSources: () => [rows[1]] } }, 'åland')
			.results[0];
		expect(whitespace.highlight).toEqual({ target: 'title', start: 0, end: 9 });
		expect(combining.highlight).toEqual({ target: 'title', start: 0, end: 6 });
	});
});
