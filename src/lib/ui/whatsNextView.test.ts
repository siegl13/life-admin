import { describe, expect, it } from 'vitest';
import {
	countWhatsNextActions,
	parseWhatsNextFilter,
	projectWhatsNextSections
} from './whatsNextView';
import type { WhatsNextGroup } from '$lib/domain/whatsnext/whatsNext';

const groups: WhatsNextGroup[] = [
	{
		itemId: 'item-1',
		title: 'Overdue-only item',
		actions: [{ actionId: 'a1', label: 'Overdue task', dueDate: '2020-01-01', bucket: 0 }]
	},
	{
		itemId: 'item-2',
		title: 'Mixed item',
		actions: [
			{ actionId: 'a2', label: 'Overdue part', dueDate: '2020-01-02', bucket: 0 },
			{ actionId: 'a3', label: 'Ready part', dueDate: null, bucket: 1 }
		]
	},
	{
		itemId: 'item-3',
		title: 'Later-only item',
		actions: [{ actionId: 'a4', label: 'Future task', dueDate: '2099-01-01', bucket: 2 }]
	}
];

describe('parseWhatsNextFilter', () => {
	it('accepts the four known values', () => {
		expect(parseWhatsNextFilter('all')).toBe('all');
		expect(parseWhatsNextFilter('overdue')).toBe('overdue');
		expect(parseWhatsNextFilter('now')).toBe('now');
		expect(parseWhatsNextFilter('later')).toBe('later');
	});

	it('falls back to all for missing or unknown values', () => {
		expect(parseWhatsNextFilter(null)).toBe('all');
		expect(parseWhatsNextFilter('')).toBe('all');
		expect(parseWhatsNextFilter('bogus')).toBe('all');
	});
});

describe('countWhatsNextActions', () => {
	it('counts actions (not items) per bucket from the full unfiltered set', () => {
		expect(countWhatsNextActions(groups)).toEqual({ all: 4, overdue: 2, now: 1, later: 1 });
	});

	it('returns all zeros for an empty working set', () => {
		expect(countWhatsNextActions([])).toEqual({ all: 0, overdue: 0, now: 0, later: 0 });
	});
});

describe('projectWhatsNextSections', () => {
	it(
		'splits the mixed item across both of its buckets' + ' under "all", one action per section',
		() => {
			const sections = projectWhatsNextSections(groups, 'all');
			expect(sections.map((s) => s.bucket)).toEqual([0, 1, 2]);

			const overdueSection = sections.find((s) => s.bucket === 0)!;
			expect(overdueSection.groups.map((g) => g.itemId)).toEqual(['item-1', 'item-2']);
			const mixedInOverdue = overdueSection.groups.find((g) => g.itemId === 'item-2')!;
			expect(mixedInOverdue.actions.map((a) => a.actionId)).toEqual(['a2']);

			const readySection = sections.find((s) => s.bucket === 1)!;
			expect(readySection.groups.map((g) => g.itemId)).toEqual(['item-2']);
			expect(readySection.groups[0].actions.map((a) => a.actionId)).toEqual(['a3']);
		}
	);

	it('sorts dated actions by due date and leaves undated ready actions in their original order', () => {
		const input: WhatsNextGroup[] = [
			{
				itemId: 'later-item',
				title: 'Later item',
				actions: [
					{ actionId: 'late', label: 'Later', dueDate: '2026-09-01', bucket: 2 },
					{ actionId: 'ready-1', label: 'Ready 1', dueDate: null, bucket: 1 },
					{ actionId: 'soon', label: 'Soon', dueDate: '2026-06-20', bucket: 2 },
					{ actionId: 'ready-2', label: 'Ready 2', dueDate: null, bucket: 1 }
				]
			},
			{
				itemId: 'middle-item',
				title: 'Middle item',
				actions: [{ actionId: 'middle', label: 'Middle', dueDate: '2026-07-01', bucket: 2 }]
			}
		];
		const sections = projectWhatsNextSections(input, 'all');
		expect(sections[2].groups.map((group) => group.actions[0].actionId)).toEqual([
			'soon',
			'middle',
			'late'
		]);
		expect(sections[1].groups.map((group) => group.actions[0].actionId)).toEqual([
			'ready-1',
			'ready-2'
		]);
	});

	it('every action from a mixed item appears exactly once across all "all" sections', () => {
		const sections = projectWhatsNextSections(groups, 'all');
		const allActionIds = sections.flatMap((s) =>
			s.groups.flatMap((g) => g.actions.map((a) => a.actionId))
		);
		expect(allActionIds.sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
	});

	it('returns exactly one (possibly empty) section for a single-bucket filter', () => {
		const sections = projectWhatsNextSections(groups, 'later');
		expect(sections).toHaveLength(1);
		expect(sections[0].bucket).toBe(2);
		expect(sections[0].groups.map((g) => g.itemId)).toEqual(['item-3']);
	});

	it('returns an empty section rather than omitting it when a bucket has no matches', () => {
		const sections = projectWhatsNextSections([], 'overdue');
		expect(sections).toEqual([{ bucket: 0, groups: [] }]);
	});
});
