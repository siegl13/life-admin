import { describe, expect, it } from 'vitest';
import type { WhatsNextItemInput } from '$lib/domain/whatsnext/whatsNext';
import { getWeeklyOverview } from './getWeeklyOverview';

function action(overrides: Partial<WhatsNextItemInput['actions'][number]> = {}) {
	return {
		actionId: 'a1',
		label: 'Do thing',
		state: 'OPEN' as const,
		dueKind: 'MANUAL' as const,
		dueDate: null,
		dueOverrideDate: null,
		position: 0,
		dependencyStates: [],
		...overrides
	};
}

function item(overrides: Partial<WhatsNextItemInput> = {}): WhatsNextItemInput {
	return {
		itemId: 'item-1',
		title: 'Item',
		actions: [],
		...overrides
	};
}

describe('getWeeklyOverview', () => {
	// 2026-10-08 is a Thursday, so the coming Sunday is 2026-10-11.
	const todayIso = '2026-10-08';

	it('includes an OPEN action due today even though buildUpcoming excludes today', () => {
		const items = [
			item({ actions: [action({ actionId: 'today', dueKind: 'DERIVED', dueDate: '2026-10-08' })] })
		];

		const rows = getWeeklyOverview(items, todayIso);

		expect(rows.rows).toEqual([
			{
				itemId: 'item-1',
				itemTitle: 'Item',
				actionId: 'today',
				label: 'Do thing',
				dueDate: '2026-10-08'
			}
		]);
	});

	it('excludes a resolved-date action due the Monday after the coming Sunday', () => {
		const items = [
			item({ actions: [action({ actionId: 'monday', dueKind: 'DERIVED', dueDate: '2026-10-12' })] })
		];

		expect(getWeeklyOverview(items, todayIso).rows).toEqual([]);
	});

	it('excludes DONE/SKIPPED actions and unresolved DERIVED due dates', () => {
		const items = [
			item({
				actions: [
					action({ actionId: 'done', dueKind: 'DERIVED', dueDate: '2026-10-09', state: 'DONE' }),
					action({ actionId: 'unresolved', dueKind: 'DERIVED', dueDate: null })
				]
			})
		];

		expect(getWeeklyOverview(items, todayIso).rows).toEqual([]);
	});

	it('sorts by due date, then item title, then ids, and caps at five rows', () => {
		const items = Array.from({ length: 6 }, (_, i) =>
			item({
				itemId: `item-${i}`,
				title: `Item ${i}`,
				actions: [
					action({
						actionId: `a-${i}`,
						dueKind: 'DERIVED',
						dueDate: '2026-10-11'
					})
				]
			})
		);

		const rows = getWeeklyOverview(items, todayIso);

		expect(rows.rows).toHaveLength(5);
		expect(rows.remaining).toBe(1);
		expect(rows.rows.map((r) => r.itemTitle)).toEqual([
			'Item 0',
			'Item 1',
			'Item 2',
			'Item 3',
			'Item 4'
		]);
	});

	it('applies a due-date override and sorts a today row before a later-in-week row', () => {
		const items = [
			item({
				itemId: 'item-a',
				title: 'B item',
				actions: [action({ actionId: 'a', dueKind: 'DERIVED', dueDate: '2026-10-10' })]
			}),
			item({
				itemId: 'item-b',
				title: 'A item',
				actions: [
					action({
						actionId: 'b',
						dueKind: 'DERIVED',
						dueDate: '2026-10-12',
						dueOverrideDate: '2026-10-08'
					})
				]
			})
		];

		const rows = getWeeklyOverview(items, todayIso);

		expect(rows.rows.map((r) => r.actionId)).toEqual(['b', 'a']);
	});
});
