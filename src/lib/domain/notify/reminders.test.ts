import { describe, expect, it } from 'vitest';
import { buildDueReminders } from './reminders';

const candidate = {
	itemId: 'item',
	itemTitle: 'House',
	actionId: 'action',
	actionLabel: 'Cancel',
	dueDate: '2026-06-10',
	bucket: 2 as const,
	leadDays: 7
};

describe('buildDueReminders', () => {
	it('uses each candidate lead time and preserves the due date as the dedupe target', () => {
		expect(
			buildDueReminders(
				[
					{ ...candidate, leadDays: 7 },
					{ ...candidate, actionId: 'other', leadDays: 2 }
				],
				'2026-06-03'
			)
		).toEqual([
			{
				itemId: 'item',
				itemTitle: 'House',
				actionId: 'action',
				actionLabel: 'Cancel',
				kind: 'DUE_SOON',
				targetDate: '2026-06-10'
			}
		]);
	});

	it('sends overdue once and keeps undated work silent', () => {
		expect(
			buildDueReminders(
				[
					{ ...candidate, bucket: 0, dueDate: '2026-06-01' },
					{ ...candidate, actionId: 'undated', dueDate: null, bucket: 1 }
				],
				'2026-06-03'
			)
		).toEqual([
			{
				itemId: 'item',
				itemTitle: 'House',
				actionId: 'action',
				actionLabel: 'Cancel',
				kind: 'OVERDUE',
				targetDate: '2026-06-01'
			}
		]);
	});
});
