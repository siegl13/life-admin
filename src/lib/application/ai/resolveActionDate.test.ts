import { describe, expect, it } from 'vitest';
import { collectAnchorDates, resolveActionDate } from './resolveActionDate';

const anchors = new Map([['contract_end', '2031-03-31']]);

describe('resolveActionDate', () => {
	it('uses an absolute DUE_BY date as the due date', () => {
		expect(
			resolveActionDate({ kind: 'DUE_BY', value: '2031-03-01', relative: null }, anchors)
		).toEqual({ status: 'DUE', kind: 'DUE_BY', date: '2031-03-01' });
	});

	it('uses an absolute ON_DATE as the due date', () => {
		expect(
			resolveActionDate({ kind: 'ON_DATE', value: '2031-03-05', relative: null }, anchors)
		).toEqual({ status: 'DUE', kind: 'ON_DATE', date: '2031-03-05' });
	});

	it('never turns availability or an estimate into a deadline', () => {
		expect(
			resolveActionDate({ kind: 'AVAILABLE_FROM', value: '2031-04-01', relative: null }, anchors)
		).toEqual({ status: 'INFORMATIONAL', kind: 'AVAILABLE_FROM', date: '2031-04-01' });
		expect(
			resolveActionDate({ kind: 'APPROXIMATE', value: '2031-04-01', relative: null }, anchors)
		).toEqual({ status: 'INFORMATIONAL', kind: 'APPROXIMATE', date: '2031-04-01' });
	});

	it('returns NONE without a date', () => {
		expect(resolveActionDate({ kind: 'NONE', value: null, relative: null }, anchors)).toEqual({
			status: 'NONE'
		});
	});

	it('calculates a BEFORE relation deterministically from the anchor (calendar-aware months)', () => {
		const date = {
			kind: 'DUE_BY' as const,
			value: null,
			relative: {
				relation: 'BEFORE' as const,
				amount: 3,
				unit: 'MONTHS' as const,
				anchorFieldKey: 'contract_end'
			}
		};
		expect(resolveActionDate(date, anchors)).toEqual({
			status: 'DUE',
			kind: 'DUE_BY',
			date: '2030-12-31'
		});
	});

	it('calculates an AFTER relation in weeks and days', () => {
		const relative = (unit: 'WEEKS' | 'DAYS', amount: number) => ({
			kind: 'DUE_BY' as const,
			value: null,
			relative: { relation: 'AFTER' as const, amount, unit, anchorFieldKey: 'contract_end' }
		});
		expect(resolveActionDate(relative('WEEKS', 2), anchors)).toMatchObject({ date: '2031-04-14' });
		expect(resolveActionDate(relative('DAYS', 1), anchors)).toMatchObject({ date: '2031-04-01' });
	});

	it('keeps a relative AVAILABLE_FROM informational', () => {
		expect(
			resolveActionDate(
				{
					kind: 'AVAILABLE_FROM',
					value: null,
					relative: { relation: 'BEFORE', amount: 1, unit: 'DAYS', anchorFieldKey: 'contract_end' }
				},
				anchors
			)
		).toEqual({ status: 'INFORMATIONAL', kind: 'AVAILABLE_FROM', date: '2031-03-30' });
	});

	it('does not invent a date when the anchor is missing', () => {
		expect(
			resolveActionDate(
				{
					kind: 'DUE_BY',
					value: null,
					relative: { relation: 'BEFORE', amount: 2, unit: 'WEEKS', anchorFieldKey: 'missing' }
				},
				anchors
			)
		).toEqual({ status: 'UNRESOLVED', kind: 'DUE_BY' });
	});

	it('does not fall back to an absolute value when the relative anchor is missing', () => {
		expect(
			resolveActionDate(
				{
					kind: 'DUE_BY',
					value: '2031-01-01',
					relative: { relation: 'BEFORE', amount: 2, unit: 'WEEKS', anchorFieldKey: 'missing' }
				},
				anchors
			)
		).toEqual({ status: 'UNRESOLVED', kind: 'DUE_BY' });
	});

	it('leaves an unusable absolute date unresolved', () => {
		expect(resolveActionDate({ kind: 'DUE_BY', value: null, relative: null }, anchors)).toEqual({
			status: 'UNRESOLVED',
			kind: 'DUE_BY'
		});
		expect(
			resolveActionDate({ kind: 'DUE_BY', value: '31.12.2031', relative: null }, anchors)
		).toEqual({ status: 'UNRESOLVED', kind: 'DUE_BY' });
	});
});

describe('collectAnchorDates', () => {
	const fields = [
		{ fieldKey: 'contract_end', type: 'date', value: '2030-06-30' },
		{ fieldKey: 'next_inspection', type: 'date', value: null },
		{ fieldKey: 'note', type: 'text', value: '2030-01-01' },
		{ fieldKey: 'broken', type: 'date', value: 'not a date' }
	];

	it('prefers the Item’s current date over the document’s value', () => {
		const result = collectAnchorDates(fields, new Map([['contract_end', '2031-03-31']]));
		expect(result.get('contract_end')).toBe('2030-06-30');
	});

	it('falls back to the document’s suggested date for an empty date field', () => {
		const result = collectAnchorDates(fields, new Map([['next_inspection', '2031-03-15']]));
		expect(result.get('next_inspection')).toBe('2031-03-15');
	});

	it('ignores non-date fields, empty fields and invalid values', () => {
		const result = collectAnchorDates(fields, new Map([['broken', 'also bad']]));
		expect([...result.keys()]).toEqual(['contract_end']);
	});
});
