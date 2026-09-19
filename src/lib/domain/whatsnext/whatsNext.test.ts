import { describe, expect, it } from 'vitest';
import { buildWhatsNext, type WhatsNextActionInput, type WhatsNextItemInput } from './whatsNext';

const TODAY = '2026-09-06';

function action(overrides: Partial<WhatsNextActionInput>): WhatsNextActionInput {
	return {
		actionId: 'a1',
		label: 'Do something',
		state: 'OPEN',
		dueKind: 'NONE',
		dueDate: null,
		dueOverrideDate: null,
		position: 0,
		dependencyStates: [],
		...overrides
	};
}

function item(overrides: Partial<WhatsNextItemInput>): WhatsNextItemInput {
	return {
		itemId: 'i1',
		title: 'Item',
		actions: [],
		...overrides
	};
}

describe('buildWhatsNext', () => {
	it('omits an item with no available actions', () => {
		const groups = buildWhatsNext(
			[item({ actions: [action({ dueKind: 'DERIVED', dueDate: null } as never)] })],
			TODAY
		);
		expect(groups).toEqual([]);
	});

	it('excludes an unresolved DERIVED action (critical: never incorrectly due)', () => {
		const groups = buildWhatsNext(
			[
				item({
					actions: [
						action({ actionId: 'a1', dueKind: 'DERIVED' as const, dueDate: null } as never),
						action({ actionId: 'a2', dueKind: 'NONE', dueDate: null })
					]
				})
			],
			TODAY
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].actions.map((a) => a.actionId)).toEqual(['a2']);
	});

	it('excludes an action whose dependency is still OPEN', () => {
		const groups = buildWhatsNext(
			[
				item({
					actions: [action({ dependencyStates: ['OPEN'] })]
				})
			],
			TODAY
		);
		expect(groups).toEqual([]);
	});

	it('includes an action once its dependency is DONE/SKIPPED', () => {
		const groups = buildWhatsNext(
			[item({ actions: [action({ dependencyStates: ['DONE', 'SKIPPED'] })] })],
			TODAY
		);
		expect(groups).toHaveLength(1);
	});

	it('buckets overdue before ready-undated before future-dated, within one item', () => {
		const groups = buildWhatsNext(
			[
				item({
					actions: [
						action({
							actionId: 'future',
							dueKind: 'DERIVED' as const,
							dueDate: '2030-01-01'
						} as never),
						action({ actionId: 'ready', dueKind: 'NONE', dueDate: null }),
						action({
							actionId: 'overdue',
							dueKind: 'DERIVED' as const,
							dueDate: '2020-01-01'
						} as never)
					]
				})
			],
			TODAY
		);
		expect(groups[0].actions.map((a) => a.actionId)).toEqual(['overdue', 'ready', 'future']);
		expect(groups[0].actions.map((a) => a.bucket)).toEqual([0, 1, 2]);
	});

	it('groups multiple available actions beneath their item (never flattened)', () => {
		const groups = buildWhatsNext(
			[
				item({
					itemId: 'nv-max',
					title: 'NV-Bescheinigung Max',
					actions: [
						action({ actionId: 'a1', label: 'Request new certificate' }),
						action({ actionId: 'a2', label: 'Check receipt', position: 1 })
					]
				})
			],
			TODAY
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].title).toBe('NV-Bescheinigung Max');
		expect(groups[0].actions).toHaveLength(2);
	});

	it('sorts items with an overdue action before items with only future actions', () => {
		const groups = buildWhatsNext(
			[
				item({
					itemId: 'future-item',
					title: 'B',
					actions: [action({ dueKind: 'DERIVED' as const, dueDate: '2030-01-01' } as never)]
				}),
				item({
					itemId: 'overdue-item',
					title: 'A',
					actions: [action({ dueKind: 'DERIVED' as const, dueDate: '2020-01-01' } as never)]
				})
			],
			TODAY
		);
		expect(groups.map((g) => g.itemId)).toEqual(['overdue-item', 'future-item']);
	});

	it('sorts two overdue items by which is more overdue (earlier due date first)', () => {
		const groups = buildWhatsNext(
			[
				item({
					itemId: 'less-overdue',
					title: 'B',
					actions: [action({ dueKind: 'DERIVED' as const, dueDate: '2026-08-01' } as never)]
				}),
				item({
					itemId: 'more-overdue',
					title: 'A',
					actions: [action({ dueKind: 'DERIVED' as const, dueDate: '2020-01-01' } as never)]
				})
			],
			TODAY
		);
		expect(groups.map((g) => g.itemId)).toEqual(['more-overdue', 'less-overdue']);
	});

	it('when both items are only "ready now" but one also has a future action, the future date breaks the tie', () => {
		// Both items' minimum bucket is 1 (ready-now); the item with an
		// additional future-dated action sorts first, ahead of the item
		// that has nothing dated at all — this is the actual, subtle
		// tiebreak behavior of the group-level sort and is worth locking
		// down explicitly rather than relying on it accidentally working.
		const groups = buildWhatsNext(
			[
				item({
					itemId: 'ready-only',
					title: 'Z',
					actions: [action({ dueKind: 'NONE', dueDate: null })]
				}),
				item({
					itemId: 'ready-plus-future',
					title: 'A',
					actions: [
						action({ actionId: 'ready', dueKind: 'NONE', dueDate: null }),
						action({
							actionId: 'future',
							dueKind: 'DERIVED' as const,
							dueDate: '2030-01-01'
						} as never)
					]
				})
			],
			TODAY
		);
		expect(groups.map((g) => g.itemId)).toEqual(['ready-plus-future', 'ready-only']);
	});

	it('breaks ties between items by title for stable ordering', () => {
		const groups = buildWhatsNext(
			[
				item({ itemId: 'z', title: 'Zebra', actions: [action({})] }),
				item({ itemId: 'a', title: 'Apple', actions: [action({})] })
			],
			TODAY
		);
		expect(groups.map((g) => g.title)).toEqual(['Apple', 'Zebra']);
	});

	it('treats an undated MANUAL action as ready-now (bucket 1)', () => {
		const groups = buildWhatsNext(
			[item({ actions: [action({ dueKind: 'MANUAL', dueDate: null })] })],
			TODAY
		);
		expect(groups[0].actions[0].bucket).toBe(1);
	});

	it('a DONE action never appears even if it would otherwise be available', () => {
		const groups = buildWhatsNext([item({ actions: [action({ state: 'DONE' })] })], TODAY);
		expect(groups).toEqual([]);
	});

	describe('due-date override precedence (the playbook calculates the default, the user has the final say)', () => {
		it('uses the override date, not the calculated date, for the displayed due date', () => {
			const groups = buildWhatsNext(
				[
					item({
						actions: [
							action({
								dueKind: 'DERIVED',
								dueDate: '2026-09-30',
								dueOverrideDate: '2026-10-05'
							})
						]
					})
				],
				TODAY
			);
			expect(groups[0].actions[0].dueDate).toBe('2026-10-05');
		});

		it('buckets by the override date: an override in the past is overdue even though the calculated date is not', () => {
			const groups = buildWhatsNext(
				[
					item({
						actions: [
							action({
								dueKind: 'DERIVED',
								dueDate: '2099-01-01', // far future calculated date
								dueOverrideDate: '2020-01-01' // overdue override
							})
						]
					})
				],
				TODAY
			);
			expect(groups[0].actions[0].bucket).toBe(0); // overdue
		});

		it('orders by the override date, not the calculated date', () => {
			const groups = buildWhatsNext(
				[
					item({
						itemId: 'i1',
						actions: [
							action({
								actionId: 'earlier-override',
								dueKind: 'DERIVED',
								dueDate: '2026-12-31', // calculated: last
								dueOverrideDate: '2026-10-01' // override: first
							}),
							action({
								actionId: 'later-plain',
								dueKind: 'DERIVED',
								dueDate: '2026-11-01',
								dueOverrideDate: null
							})
						]
					})
				],
				TODAY
			);
			expect(groups[0].actions.map((a) => a.actionId)).toEqual(['earlier-override', 'later-plain']);
		});

		it('remains available (not "unresolved") based on the calculated date, even if an override is also set', () => {
			// The calculated date is still unknown (unresolved DERIVED action);
			// availability is not editable, so this must stay excluded from
			// What's Next regardless of the override.
			const groups = buildWhatsNext(
				[
					item({
						actions: [action({ dueKind: 'DERIVED', dueDate: null, dueOverrideDate: '2026-10-05' })]
					})
				],
				TODAY
			);
			expect(groups).toEqual([]);
		});
	});
});
