import { describe, expect, it } from 'vitest';
import { buildUpcoming, type UpcomingRangeKey } from './upcoming';
import type { WhatsNextActionInput, WhatsNextItemInput } from '../whatsnext/whatsNext';

const TODAY = '2026-09-05'; // Saturday; the coming Sunday is 2026-09-06.

function action(overrides: Partial<WhatsNextActionInput>): WhatsNextActionInput {
	return {
		actionId: 'action-1',
		label: 'Action',
		state: 'OPEN',
		dueKind: 'MANUAL',
		dueDate: '2026-09-06',
		dueOverrideDate: null,
		position: 0,
		dependencyStates: [],
		...overrides
	};
}

function item(actions: WhatsNextActionInput[]): WhatsNextItemInput {
	return { itemId: 'item-1', title: 'Item', actions };
}

function range(result: ReturnType<typeof buildUpcoming>, key: UpcomingRangeKey) {
	return result.find((group) => group.key === key)!;
}

describe('buildUpcoming', () => {
	it('uses the fixed non-overlapping boundaries and excludes today', () => {
		const result = buildUpcoming(
			[
				item([
					action({ actionId: 'today', dueDate: TODAY }),
					action({ actionId: 'sunday', dueDate: '2026-09-06' }),
					action({ actionId: 'monday', dueDate: '2026-09-07' }),
					action({ actionId: 'plus-30', dueDate: '2026-10-05' }),
					action({ actionId: 'later', dueDate: '2026-10-06' })
				])
			],
			TODAY
		);

		expect(range(result, 'thisWeek').actions.map((a) => a.actionId)).toEqual(['sunday']);
		expect(range(result, 'next30Days').actions.map((a) => a.actionId)).toEqual([
			'monday',
			'plus-30'
		]);
		expect(range(result, 'later').actions.map((a) => a.actionId)).toEqual(['later']);
		expect(result.flatMap((group) => group.actions)).toHaveLength(4);
	});

	it('makes this week empty on Sunday and puts the next day in the 30-day range', () => {
		const result = buildUpcoming(
			[item([action({ actionId: 'monday', dueDate: '2026-09-07' })])],
			'2026-09-06'
		);

		expect(range(result, 'thisWeek').actions).toEqual([]);
		expect(range(result, 'next30Days').actions[0].actionId).toBe('monday');
	});

	it('puts Monday through Sunday in this week when today is Monday', () => {
		const result = buildUpcoming(
			[
				item([
					action({ actionId: 'monday', dueDate: '2026-09-07' }),
					action({ actionId: 'sunday', dueDate: '2026-09-13' }),
					action({ actionId: 'next-monday', dueDate: '2026-09-14' })
				])
			],
			'2026-09-07'
		);

		expect(range(result, 'thisWeek').actions.map((a) => a.actionId)).toEqual(['sunday']);
		expect(range(result, 'next30Days').actions.map((a) => a.actionId)).toEqual(['next-monday']);
	});

	it('uses an effective override date without changing availability semantics', () => {
		const result = buildUpcoming(
			[
				item([
					action({
						dueKind: 'DERIVED',
						dueDate: '2026-12-01',
						dueOverrideDate: '2026-09-07',
						dependencyStates: ['OPEN']
					})
				])
			],
			TODAY
		);

		expect(range(result, 'next30Days').actions[0]).toMatchObject({
			dueDate: '2026-09-07',
			available: false
		});
	});

	it('excludes unresolved, undated, completed, and skipped actions', () => {
		const result = buildUpcoming(
			[
				item([
					action({ actionId: 'unresolved', dueKind: 'DERIVED', dueDate: null } as never),
					action({
						actionId: 'override-unresolved',
						dueKind: 'DERIVED',
						dueDate: null,
						dueOverrideDate: '2026-09-07'
					}),
					action({ actionId: 'undated', dueKind: 'NONE', dueDate: null }),
					action({ actionId: 'done', state: 'DONE' }),
					action({ actionId: 'skipped', state: 'SKIPPED' })
				])
			],
			TODAY
		);

		expect(result.flatMap((group) => group.actions)).toEqual([]);
	});

	it('includes each action once and sorts by date, item, and action id', () => {
		const result = buildUpcoming(
			[
				{
					itemId: 'b',
					title: 'Beta',
					actions: [action({ actionId: 'b-action', dueDate: '2026-09-07' })]
				},
				{
					itemId: 'a',
					title: 'Alpha',
					actions: [action({ actionId: 'a-action', dueDate: '2026-09-07' })]
				}
			],
			TODAY
		);

		expect(range(result, 'next30Days').actions.map((a) => a.itemId)).toEqual(['a', 'b']);
		expect(new Set(result.flatMap((group) => group.actions).map((a) => a.actionId)).size).toBe(2);
	});
});
