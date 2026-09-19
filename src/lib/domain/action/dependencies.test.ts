import { describe, expect, it } from 'vitest';
import { findDependencyCycle, isAvailable } from './dependencies';

describe('findDependencyCycle', () => {
	it('accepts a simple acyclic chain', () => {
		const edges = new Map([
			['a', []],
			['b', ['a']],
			['c', ['b']]
		]);
		expect(findDependencyCycle(edges)).toBeNull();
	});

	it('accepts a diamond graph', () => {
		const edges = new Map([
			['a', []],
			['b', ['a']],
			['c', ['a']],
			['d', ['b', 'c']]
		]);
		expect(findDependencyCycle(edges)).toBeNull();
	});

	it('detects a self-dependency', () => {
		const edges = new Map([['a', ['a']]]);
		expect(findDependencyCycle(edges)).toEqual(['a']);
	});

	it('detects a 2-cycle', () => {
		const edges = new Map([
			['a', ['b']],
			['b', ['a']]
		]);
		expect(findDependencyCycle(edges)).toEqual(['a', 'b']);
	});

	it('detects a 3-cycle', () => {
		const edges = new Map([
			['a', ['b']],
			['b', ['c']],
			['c', ['a']]
		]);
		expect(findDependencyCycle(edges)).toEqual(['a', 'b', 'c']);
	});

	it('reports every node whose resolution transitively depends on a cycle', () => {
		// 'end' depends on 'a', which is stuck in the a<->b cycle, so 'end'
		// can never resolve either and is correctly included.
		const edges = new Map([
			['start', []],
			['a', ['b']],
			['b', ['a']],
			['end', ['a']]
		]);
		expect(findDependencyCycle(edges)).toEqual(['a', 'b', 'end']);
	});
});

describe('isAvailable', () => {
	it('is available when OPEN, no deps, and NONE due kind', () => {
		expect(isAvailable({ state: 'OPEN', dueKind: 'NONE', dueDate: null }, [])).toBe(true);
	});

	it('is not available when already DONE', () => {
		expect(isAvailable({ state: 'DONE', dueKind: 'NONE', dueDate: null }, [])).toBe(false);
	});

	it('is not available when already SKIPPED', () => {
		expect(isAvailable({ state: 'SKIPPED', dueKind: 'NONE', dueDate: null }, [])).toBe(false);
	});

	it('is not available while a dependency is still OPEN', () => {
		expect(isAvailable({ state: 'OPEN', dueKind: 'NONE', dueDate: null }, ['OPEN'])).toBe(false);
	});

	it('is available once all dependencies are DONE or SKIPPED (mixed)', () => {
		expect(
			isAvailable({ state: 'OPEN', dueKind: 'NONE', dueDate: null }, ['DONE', 'SKIPPED'])
		).toBe(true);
	});

	it('is available for a resolved DERIVED action', () => {
		expect(isAvailable({ state: 'OPEN', dueKind: 'DERIVED', dueDate: '2026-10-01' }, [])).toBe(
			true
		);
	});

	it('is NOT available for an unresolved DERIVED action (critical rule)', () => {
		expect(isAvailable({ state: 'OPEN', dueKind: 'DERIVED', dueDate: null }, [])).toBe(false);
	});

	it('is available for a MANUAL action with no date', () => {
		expect(isAvailable({ state: 'OPEN', dueKind: 'MANUAL', dueDate: null }, [])).toBe(true);
	});

	it('is available for a MANUAL action with a date', () => {
		expect(isAvailable({ state: 'OPEN', dueKind: 'MANUAL', dueDate: '2026-10-01' }, [])).toBe(true);
	});
});
