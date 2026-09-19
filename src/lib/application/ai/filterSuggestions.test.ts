import { describe, expect, it } from 'vitest';
import { filterSuggestions } from './filterSuggestions';
import type { ExtractionFieldDefinition } from './extraction';

const FIELDS: ExtractionFieldDefinition[] = [
	{ fieldKey: 'contract_end', label: 'Contract end', type: 'date' },
	{ fieldKey: 'note', label: 'Note', type: 'text' }
];

describe('filterSuggestions', () => {
	it('discards a suggestion for an unknown field key', () => {
		const { kept, discarded } = filterSuggestions(
			[{ fieldKey: 'not_a_real_field', value: 'x' }],
			FIELDS
		);
		expect(kept).toEqual([]);
		expect(discarded).toEqual([{ fieldKey: 'not_a_real_field', reason: 'UNKNOWN_FIELD' }]);
	});

	it('discards a key belonging to another item’s cycle (not present in this request’s fields)', () => {
		const { kept, discarded } = filterSuggestions(
			[{ fieldKey: 'other_items_field', value: '2027-01-01' }],
			FIELDS
		);
		expect(kept).toEqual([]);
		expect(discarded[0].reason).toBe('UNKNOWN_FIELD');
	});

	it('discards a non-ISO date for a date field (e.g. 31.12.2027), never coerces it', () => {
		const { kept, discarded } = filterSuggestions(
			[{ fieldKey: 'contract_end', value: '31.12.2027' }],
			FIELDS
		);
		expect(kept).toEqual([]);
		expect(discarded).toEqual([{ fieldKey: 'contract_end', reason: 'INVALID_DATE' }]);
	});

	it('keeps a valid ISO date for a date field', () => {
		const { kept } = filterSuggestions([{ fieldKey: 'contract_end', value: '2027-12-31' }], FIELDS);
		expect(kept).toEqual([{ fieldKey: 'contract_end', value: '2027-12-31' }]);
	});

	it('keeps free text and trims it', () => {
		const { kept } = filterSuggestions([{ fieldKey: 'note', value: '  hello  ' }], FIELDS);
		expect(kept).toEqual([{ fieldKey: 'note', value: 'hello' }]);
	});

	it('discards a whitespace-only value as empty', () => {
		const { kept, discarded } = filterSuggestions([{ fieldKey: 'note', value: '   ' }], FIELDS);
		expect(kept).toEqual([]);
		expect(discarded).toEqual([{ fieldKey: 'note', reason: 'EMPTY' }]);
	});

	it('keeps the first of a duplicate key and discards the rest', () => {
		const { kept, discarded } = filterSuggestions(
			[
				{ fieldKey: 'note', value: 'first' },
				{ fieldKey: 'note', value: 'second' }
			],
			FIELDS
		);
		expect(kept).toEqual([{ fieldKey: 'note', value: 'first' }]);
		expect(discarded).toEqual([{ fieldKey: 'note', reason: 'DUPLICATE' }]);
	});

	it('discards a value over 500 characters', () => {
		const { kept, discarded } = filterSuggestions(
			[{ fieldKey: 'note', value: 'x'.repeat(501) }],
			FIELDS
		);
		expect(kept).toEqual([]);
		expect(discarded).toEqual([{ fieldKey: 'note', reason: 'TOO_LONG' }]);
	});

	it('keeps a value exactly at the 500 character cap', () => {
		const { kept } = filterSuggestions([{ fieldKey: 'note', value: 'x'.repeat(500) }], FIELDS);
		expect(kept).toHaveLength(1);
	});

	it('does not know about current values at all — filtering never compares against one', () => {
		// filterSuggestions has no currentValue parameter; a value equal to
		// the current one is kept here and hidden later by the review UI
		// (getExtractionRun), not dropped by this filter.
		const { kept } = filterSuggestions([{ fieldKey: 'note', value: 'same as current' }], FIELDS);
		expect(kept).toEqual([{ fieldKey: 'note', value: 'same as current' }]);
	});

	// A dedicated "more suggestions than fields -> OVER_LIMIT" case is
	// deliberately not added: since `kept` only ever grows by one *new*
	// distinct real field key at a time (DUPLICATE already rejects a
	// repeat), kept.length can never exceed the number of distinct real
	// field keys — which is exactly fields.length for the real
	// cycle-fields repository (field_key is unique per cycle by DB
	// constraint). The `kept.length >= fields.length` cap is a defensive
	// backstop against that invariant ever changing, not a reachable
	// discard path today; forcing it would require a non-representative
	// `fields` list with a duplicate key, which the real repository never
	// produces.
});
