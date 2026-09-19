import { describe, expect, it } from 'vitest';
import { assertValidTransition, canTransition, InvalidActionTransitionError } from './transitions';
import type { ActionState } from './action';

describe('canTransition', () => {
	it('allows OPEN -> DONE', () => {
		expect(canTransition('OPEN', 'DONE')).toBe(true);
	});

	it('allows OPEN -> SKIPPED', () => {
		expect(canTransition('OPEN', 'SKIPPED')).toBe(true);
	});

	it('allows DONE -> OPEN (reopening)', () => {
		expect(canTransition('DONE', 'OPEN')).toBe(true);
	});

	it('allows SKIPPED -> OPEN (reopening)', () => {
		expect(canTransition('SKIPPED', 'OPEN')).toBe(true);
	});

	const rejected: [ActionState, ActionState][] = [
		['DONE', 'SKIPPED'],
		['SKIPPED', 'DONE'],
		['OPEN', 'OPEN'],
		['DONE', 'DONE'],
		['SKIPPED', 'SKIPPED']
	];

	it.each(rejected)('rejects %s -> %s', (from, to) => {
		expect(canTransition(from, to)).toBe(false);
	});
});

describe('assertValidTransition', () => {
	it('does not throw for an allowed transition', () => {
		expect(() => assertValidTransition('OPEN', 'DONE')).not.toThrow();
	});

	it('does not throw for reopening', () => {
		expect(() => assertValidTransition('DONE', 'OPEN')).not.toThrow();
	});

	it('throws InvalidActionTransitionError for a disallowed transition', () => {
		expect(() => assertValidTransition('DONE', 'SKIPPED')).toThrow(InvalidActionTransitionError);
	});
});
