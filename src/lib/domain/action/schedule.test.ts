import { describe, expect, it } from 'vitest';
import type { Event } from '../event/event';
import type { Field } from '../field/field';
import type { Action } from './action';
import { deriveActionDueDates, deriveSchedule, resolveEvents } from './schedule';

function field(overrides: Partial<Field>): Field {
	return {
		id: 'f1',
		cycleId: 'c1',
		fieldKey: 'valid_until',
		label: 'Valid until',
		type: 'date',
		origin: 'PLAYBOOK',
		recommended: true,
		position: 0,
		value: null,
		...overrides
	};
}

function event(overrides: Partial<Event>): Event {
	return {
		id: 'e1',
		cycleId: 'c1',
		eventKey: 'expiry',
		label: 'Expiry',
		sourceFieldKey: 'valid_until',
		resolvedDate: null,
		position: 0,
		...overrides
	};
}

function derivedAction(overrides: Partial<Action> & { dueKind: 'DERIVED' }): Action {
	return {
		id: 'a1',
		cycleId: 'c1',
		actionKey: 'request_new',
		label: 'Request new',
		description: null,
		state: 'OPEN',
		position: 0,
		createdAt: '2026-01-01T00:00:00.000Z',
		completedAt: null,
		dueEventKey: 'expiry',
		dueOffset: { months: -2 },
		dueDate: null,
		...overrides
	} as Action;
}

describe('resolveEvents', () => {
	it('resolves to null while the source field is empty', () => {
		const result = resolveEvents([field({ value: null })], [event({})]);
		expect(result).toEqual([{ eventKey: 'expiry', resolvedDate: null }]);
	});

	it('resolves to the field value once entered', () => {
		const result = resolveEvents([field({ value: '2028-08-31' })], [event({})]);
		expect(result).toEqual([{ eventKey: 'expiry', resolvedDate: '2028-08-31' }]);
	});

	it('resolves to null if the source field key does not match any field', () => {
		const result = resolveEvents([field({ fieldKey: 'other' })], [event({})]);
		expect(result).toEqual([{ eventKey: 'expiry', resolvedDate: null }]);
	});
});

describe('deriveActionDueDates', () => {
	it('leaves a DERIVED action unresolved while its event has no date', () => {
		const result = deriveActionDueDates(
			[derivedAction({ dueKind: 'DERIVED' })],
			[{ eventKey: 'expiry', resolvedDate: null }]
		);
		expect(result).toEqual([{ actionKey: 'request_new', dueDate: null }]);
	});

	it('derives a due date once the event resolves', () => {
		const result = deriveActionDueDates(
			[derivedAction({ dueKind: 'DERIVED' })],
			[{ eventKey: 'expiry', resolvedDate: '2028-08-31' }]
		);
		expect(result).toEqual([{ actionKey: 'request_new', dueDate: '2028-06-30' }]);
	});

	it('a zero offset means the action is due exactly at the event date', () => {
		const result = deriveActionDueDates(
			[derivedAction({ dueKind: 'DERIVED', dueOffset: {} })],
			[{ eventKey: 'expiry', resolvedDate: '2028-08-31' }]
		);
		expect(result).toEqual([{ actionKey: 'request_new', dueDate: '2028-08-31' }]);
	});

	it('recomputes the date for a DONE action without touching its state (state is not part of this function)', () => {
		const result = deriveActionDueDates(
			[
				derivedAction({
					dueKind: 'DERIVED',
					state: 'DONE',
					completedAt: '2026-01-02T00:00:00.000Z'
				})
			],
			[{ eventKey: 'expiry', resolvedDate: '2028-08-31' }]
		);
		expect(result).toEqual([{ actionKey: 'request_new', dueDate: '2028-06-30' }]);
	});

	it('ignores NONE and MANUAL actions entirely', () => {
		const actions: Action[] = [
			{
				id: 'a2',
				cycleId: 'c1',
				actionKey: 'check_receipt',
				label: 'Check receipt',
				description: null,
				state: 'OPEN',
				position: 1,
				createdAt: '2026-01-01T00:00:00.000Z',
				completedAt: null,
				dueKind: 'NONE',
				dueDate: null,
				dueOverrideDate: null
			},
			{
				id: 'a3',
				cycleId: 'c1',
				actionKey: 'm_abc',
				label: 'Call the bank',
				description: null,
				state: 'OPEN',
				position: 2,
				createdAt: '2026-01-01T00:00:00.000Z',
				completedAt: null,
				dueKind: 'MANUAL',
				dueDate: '2026-05-01',
				dueOverrideDate: null
			}
		];
		expect(deriveActionDueDates(actions, [])).toEqual([]);
	});
});

describe('deriveSchedule', () => {
	it('chains event resolution into action due date derivation', () => {
		const result = deriveSchedule(
			[field({ value: '2028-08-31' })],
			[event({})],
			[derivedAction({ dueKind: 'DERIVED' })]
		);
		expect(result.events).toEqual([{ eventKey: 'expiry', resolvedDate: '2028-08-31' }]);
		expect(result.actions).toEqual([{ actionKey: 'request_new', dueDate: '2028-06-30' }]);
	});
});
