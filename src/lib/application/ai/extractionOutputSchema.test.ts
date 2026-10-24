import { describe, expect, it } from 'vitest';
import { extractionOutputSchema } from './extractionOutputSchema';

describe('extractionOutputSchema', () => {
	it('accepts a well-formed suggestions array', () => {
		const result = extractionOutputSchema.safeParse({
			suggestions: [{ field_key: 'contract_end', value: '2027-12-31' }]
		});
		expect(result.success).toBe(true);
	});

	it('rejects an extra top-level key', () => {
		const result = extractionOutputSchema.safeParse({
			suggestions: [],
			extra: 'unexpected'
		});
		expect(result.success).toBe(false);
	});

	describe('action_suggestions', () => {
		const valid = {
			title: 'Versicherung kündigen',
			context: null,
			evidence: 'Kündigung drei Monate vorher',
			status: 'OPEN',
			date: {
				kind: 'DUE_BY',
				value: null,
				relative: {
					relation: 'BEFORE',
					amount: 3,
					unit: 'MONTHS',
					anchor_field_key: 'contract_end'
				}
			}
		};

		it('accepts an action with a relative date, and the key stays optional', () => {
			expect(
				extractionOutputSchema.safeParse({ suggestions: [], action_suggestions: [valid] }).success
			).toBe(true);
			expect(extractionOutputSchema.safeParse({ suggestions: [] }).success).toBe(true);
		});

		it('rejects an unknown date kind, a fractional amount and extra keys', () => {
			const parse = (action: unknown) =>
				extractionOutputSchema.safeParse({ suggestions: [], action_suggestions: [action] }).success;
			expect(parse({ ...valid, date: { ...valid.date, kind: 'SOON' } })).toBe(false);
			expect(
				parse({
					...valid,
					date: { ...valid.date, relative: { ...valid.date.relative, amount: 1.5 } }
				})
			).toBe(false);
			expect(parse({ ...valid, reasoning: 'because' })).toBe(false);
		});
	});

	it('rejects prose instead of JSON structure', () => {
		const result = extractionOutputSchema.safeParse('The contract ends on 2027-12-31.');
		expect(result.success).toBe(false);
	});

	it('rejects a volunteered confidence key on a suggestion (.strict())', () => {
		const result = extractionOutputSchema.safeParse({
			suggestions: [{ field_key: 'contract_end', value: '2027-12-31', confidence: 0.9 }]
		});
		expect(result.success).toBe(false);
	});

	it('rejects more than 100 suggestions', () => {
		const suggestions = Array.from({ length: 101 }, (_, i) => ({
			field_key: `k${i}`,
			value: 'v'
		}));
		const result = extractionOutputSchema.safeParse({ suggestions });
		expect(result.success).toBe(false);
	});

	it('rejects a missing suggestions array', () => {
		const result = extractionOutputSchema.safeParse({});
		expect(result.success).toBe(false);
	});
});
