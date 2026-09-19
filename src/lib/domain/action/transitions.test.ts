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

	const rejected: [ActionState, ActionState][] = [
		['DONE', 'OPEN'],
		['SKIPPED', 'OPEN'],
		['DONE', 'SKIPPED'],
		['SKIPPED', 'DONE'],
		['OPEN', 'OPEN'],
		['DONE', 'DONE']
	];

	it.each(rejected)('rejects %s -> %s (no reopening in V1)', (from, to) => {
		expect(canTransition(from, to)).toBe(false);
	});
});

describe('assertValidTransition', () => {
	it('does not throw for an allowed transition', () => {
		expect(() => assertValidTransition('OPEN', 'DONE')).not.toThrow();
	});

	it('throws InvalidActionTransitionError for a disallowed transition', () => {
		expect(() => assertValidTransition('DONE', 'OPEN')).toThrow(InvalidActionTransitionError);
	});
});
