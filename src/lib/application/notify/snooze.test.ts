import { describe, expect, it, vi } from 'vitest';
import type { WhatsNextRepositoryPort } from '$lib/application/ports';
import type { NotificationSnooze } from '$lib/domain/notify/snooze';
import type { WhatsNextItemInput } from '$lib/domain/whatsnext/whatsNext';
import {
	clearSnooze,
	InvalidSnoozeDateError,
	IneligibleSnoozeError,
	readSnooze,
	setSnooze
} from './snooze';

const eligible = {
	loadItems: () => [
		{
			itemId: 'item',
			title: 'Item',
			actions: [
				{
					actionId: 'action',
					label: 'Action',
					state: 'OPEN' as const,
					dueKind: 'MANUAL' as const,
					dueDate: '2026-06-10',
					dueOverrideDate: null,
					position: 1,
					dependencyStates: []
				}
			]
		}
	]
};

function ports(
	items: WhatsNextRepositoryPort = eligible,
	currentSnooze: NotificationSnooze | null = null
) {
	return {
		whatsNext: items,
		clock: { todayIso: () => '2026-06-03', nowIso: () => '', localHour: () => 9 },
		snoozes: {
			set: vi.fn((input) => ({ ...input, version: 'version' }) as NotificationSnooze),
			get: vi.fn(() => currentSnooze),
			clearIfVersion: vi.fn(() => true),
			list: vi.fn(() => [])
		}
	};
}

describe('setSnooze', () => {
	it('sets presets without changing the source due date', () => {
		const instance = ports();
		setSnooze(instance, { actionId: 'action', choice: 'TOMORROW', expectedItemId: 'item' });
		expect(instance.snoozes.set).toHaveBeenCalledWith({
			actionId: 'action',
			sourceDueDate: '2026-06-10',
			snoozedUntil: '2026-06-04'
		});
	});

	it('rejects invalid dates and unavailable actions', () => {
		expect(() =>
			setSnooze(ports(), { actionId: 'action', choice: '2027-06-04', expectedItemId: 'item' })
		).toThrow(InvalidSnoozeDateError);
		expect(() =>
			setSnooze(ports({ loadItems: () => [] }), {
				actionId: 'action',
				choice: 'TOMORROW',
				expectedItemId: 'item'
			})
		).toThrow(IneligibleSnoozeError);
	});

	it('replaces an existing snooze without changing the source due date', () => {
		const instance = ports();
		setSnooze(instance, { actionId: 'action', choice: 'TOMORROW', expectedItemId: 'item' });
		setSnooze(instance, { actionId: 'action', choice: '2026-06-10', expectedItemId: 'item' });
		expect(instance.snoozes.set).toHaveBeenLastCalledWith({
			actionId: 'action',
			sourceDueDate: '2026-06-10',
			snoozedUntil: '2026-06-10'
		});
	});

	it('clears an unreadable snooze when its source due date changed', () => {
		const current = {
			actionId: 'action',
			sourceDueDate: '2026-06-09',
			snoozedUntil: '2026-06-05',
			version: 'stale'
		} satisfies NotificationSnooze;
		const instance = ports(eligible, current);

		expect(readSnooze(instance, 'action')).toBeNull();
		expect(instance.snoozes.clearIfVersion).toHaveBeenCalledWith('action', 'stale');
	});

	it('clears an active snooze by its current version', () => {
		const current = {
			actionId: 'action',
			sourceDueDate: '2026-06-10',
			snoozedUntil: '2026-06-05',
			version: 'current'
		} satisfies NotificationSnooze;
		const instance = ports(eligible, current);

		expect(clearSnooze(instance, 'action', 'item')).toBe(true);
		expect(instance.snoozes.clearIfVersion).toHaveBeenCalledWith('action', 'current');
	});

	it.each([
		['completed', { state: 'DONE' as const, dueDate: '2026-06-10', dueKind: 'MANUAL' as const }],
		['skipped', { state: 'SKIPPED' as const, dueDate: '2026-06-10', dueKind: 'MANUAL' as const }],
		[
			'blocked',
			{
				state: 'OPEN' as const,
				dueDate: '2026-06-10',
				dueKind: 'MANUAL' as const,
				dependencyStates: ['OPEN' as const]
			}
		],
		['unresolved', { state: 'OPEN' as const, dueDate: null, dueKind: 'DERIVED' as const }],
		['undated', { state: 'OPEN' as const, dueDate: null, dueKind: 'MANUAL' as const }]
	])('clears a snooze when the action becomes %s', (_name, change) => {
		const current = {
			actionId: 'action',
			sourceDueDate: '2026-06-10',
			snoozedUntil: '2026-06-05',
			version: 'stale'
		} satisfies NotificationSnooze;
		const item: WhatsNextItemInput = {
			...eligible.loadItems()[0],
			actions: [{ ...eligible.loadItems()[0].actions[0], ...change }]
		};
		const instance = ports({ loadItems: () => [item] }, current);

		expect(readSnooze(instance, 'action')).toBeNull();
		expect(instance.snoozes.clearIfVersion).toHaveBeenCalledWith('action', 'stale');
	});

	it('does not mutate an eligible action from another item', () => {
		const instance = ports({
			loadItems: () => [{ ...eligible.loadItems()[0], itemId: 'other' }]
		});

		expect(() =>
			setSnooze(instance, { actionId: 'action', choice: 'TOMORROW', expectedItemId: 'item' })
		).toThrow(IneligibleSnoozeError);
		expect(instance.snoozes.set).not.toHaveBeenCalled();
	});

	it('does not clear an eligible action from another item', () => {
		const current = {
			actionId: 'action',
			sourceDueDate: '2026-06-10',
			snoozedUntil: '2026-06-05',
			version: 'current'
		} satisfies NotificationSnooze;
		const instance = ports(
			{ loadItems: () => [{ ...eligible.loadItems()[0], itemId: 'other' }] },
			current
		);

		expect(clearSnooze(instance, 'action', 'item')).toBe(false);
		expect(instance.snoozes.clearIfVersion).not.toHaveBeenCalled();
	});
});
