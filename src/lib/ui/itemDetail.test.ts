import { afterEach, describe, expect, it } from 'vitest';
import { setLocaleProvider } from '$lib/i18n';
import { canEditActionDueDate, formatEmptyFieldCount, formatWorkflowProgress } from './itemDetail';

afterEach(() => setLocaleProvider(() => 'de'));

describe('item detail due date editor eligibility', () => {
	const derived = {
		state: 'OPEN' as const,
		dueKind: 'DERIVED' as const,
		dueDate: '2026-10-01',
		dueOverrideDate: null
	};

	it('allows a resolved open derived action', () => {
		expect(canEditActionDueDate(derived)).toBe(true);
	});

	it('allows an open derived action with an existing override and no suggestion', () => {
		expect(canEditActionDueDate({ ...derived, dueDate: null, dueOverrideDate: '2026-10-05' })).toBe(
			true
		);
	});

	it('rejects an unresolved derived action without an override', () => {
		expect(canEditActionDueDate({ ...derived, dueDate: null })).toBe(false);
	});

	it('rejects manual due dates', () => {
		expect(canEditActionDueDate({ ...derived, dueKind: 'MANUAL' })).toBe(false);
	});

	it('rejects actions that are not open', () => {
		expect(canEditActionDueDate({ ...derived, state: 'DONE' })).toBe(false);
	});
});

describe('item detail count copy', () => {
	it.each([
		{ count: 0, expected: '0 von 0 Schritten erledigt' },
		{ count: 1, expected: '1 von 1 Schritt erledigt' },
		{ count: 2, expected: '1 von 2 Schritten erledigt' }
	])('formats German workflow progress with $count total', ({ count, expected }) => {
		setLocaleProvider(() => 'de');
		expect(formatWorkflowProgress(count === 2 ? 1 : count, count)).toBe(expected);
	});

	it.each([
		{ count: 0, expected: '0 of 0 steps done' },
		{ count: 1, expected: '1 of 1 step done' },
		{ count: 2, expected: '1 of 2 steps done' }
	])('formats English workflow progress with $count total', ({ count, expected }) => {
		setLocaleProvider(() => 'en');
		expect(formatWorkflowProgress(count === 2 ? 1 : count, count)).toBe(expected);
	});

	it.each([
		{ count: 0, expected: '0 leere Angaben' },
		{ count: 1, expected: '1 leere Angabe' },
		{ count: 2, expected: '2 leere Angaben' }
	])('formats German empty-field count $count', ({ count, expected }) => {
		setLocaleProvider(() => 'de');
		expect(formatEmptyFieldCount(count)).toBe(expected);
	});

	it.each([
		{ count: 0, expected: '0 empty details' },
		{ count: 1, expected: '1 empty detail' },
		{ count: 2, expected: '2 empty details' }
	])('formats English empty-field count $count', ({ count, expected }) => {
		setLocaleProvider(() => 'en');
		expect(formatEmptyFieldCount(count)).toBe(expected);
	});
});
