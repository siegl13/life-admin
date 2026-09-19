import { describe, expect, it } from 'vitest';
import { canonicalItemPair } from './relation';

describe('canonicalItemPair', () => {
	it('returns the same ordered pair for both directions', () => {
		expect(canonicalItemPair('b', 'a')).toEqual(['a', 'b']);
		expect(canonicalItemPair('a', 'b')).toEqual(['a', 'b']);
	});
});
