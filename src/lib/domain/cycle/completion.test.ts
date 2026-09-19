import { describe, expect, it } from 'vitest';
import { isCycleComplete } from './completion';

describe('isCycleComplete', () => {
	it('is false while any action is OPEN', () => {
		expect(isCycleComplete([{ state: 'OPEN' }, { state: 'DONE' }])).toBe(false);
	});

	it('is true when every action is DONE', () => {
		expect(isCycleComplete([{ state: 'DONE' }, { state: 'DONE' }])).toBe(true);
	});

	it('is true when DONE is mixed with SKIPPED', () => {
		expect(isCycleComplete([{ state: 'DONE' }, { state: 'SKIPPED' }])).toBe(true);
	});

	it('is false for a cycle with zero actions (nothing to finish)', () => {
		expect(isCycleComplete([])).toBe(false);
	});
});
