import { describe, expect, it, vi } from 'vitest';
import type { WhatsNextItemInput } from '$lib/domain/whatsnext/whatsNext';
import type {
	NotificationChannel,
	NotificationChannelPort,
	NotificationSettings,
	RetryableDelivery,
	RetryableDeliveryKey
} from './ports';
import { dispatchDueReminders } from './dispatchDueReminders';

function ports(overrides: Record<string, unknown> = {}) {
	const listRetryable = vi.fn<
		(
			maxAttempts: number,
			limit: number,
			eligible: readonly RetryableDeliveryKey[]
		) => RetryableDelivery[]
	>(() => []);
	const get = vi.fn<(channel: NotificationChannel) => NotificationChannelPort | null>(() => ({
		send: vi.fn(async () => {})
	}));
	const loadItems = vi.fn<() => WhatsNextItemInput[]>(() => [
		{
			itemId: 'item',
			title: 'Item',
			actions: [
				{
					actionId: 'action',
					label: 'Action',
					state: 'OPEN',
					dueKind: 'MANUAL',
					dueDate: '2026-06-10',
					dueOverrideDate: null,
					position: 1,
					dependencyStates: []
				}
			]
		}
	]);
	return {
		settings: {
			getSettings: vi.fn<() => NotificationSettings>(() => ({
				enabled: true,
				channel: 'NTFY' as const,
				selectedChannelConfigured: true,
				leadDays: 7,
				reminderTime: '08:00',
				minimalContent: false
			}))
		},
		deliveries: {
			claim: vi.fn(() => true),
			markSent: vi.fn(),
			markSentAndConsumeSnooze: vi.fn(() => true),
			markAttemptFailed: vi.fn(),
			listRetryable,
			getLastFailure: vi.fn()
		},
		channels: { get },
		whatsNext: { loadItems },
		clock: {
			todayIso: () => '2026-06-03',
			nowIso: () => '2026-06-03T09:00:00.000Z',
			localHour: () => 9
		},
		origin: null,
		...overrides
	};
}

describe('dispatchDueReminders', () => {
	it('does not load work when disabled or before quiet hours end', async () => {
		const disabled = ports({
			settings: {
				getSettings: () => ({
					enabled: false,
					channel: 'NTFY',
					selectedChannelConfigured: false,
					leadDays: 7,
					reminderTime: '08:00',
					minimalContent: false
				})
			}
		});
		await dispatchDueReminders(disabled);
		expect(disabled.whatsNext.loadItems).not.toHaveBeenCalled();
		const quiet = ports({
			clock: { todayIso: () => '2026-06-03', nowIso: () => 'x', localHour: () => 7 }
		});
		await dispatchDueReminders(quiet);
		expect(quiet.whatsNext.loadItems).not.toHaveBeenCalled();
	});

	it.each(['NTFY', 'SLACK'] as const)(
		'follows the configured reminder time to the minute for %s',
		async (channel) => {
			const settings = (reminderTime: string) => ({
				getSettings: () => ({
					enabled: true,
					channel,
					selectedChannelConfigured: true,
					leadDays: 7,
					reminderTime,
					minimalContent: false
				})
			});
			const clockAt = (localMinuteOfDay: number) => ({
				todayIso: () => '2026-06-03',
				nowIso: () => '2026-06-03T09:00:00.000Z',
				localHour: () => Math.floor(localMinuteOfDay / 60),
				localMinuteOfDay: () => localMinuteOfDay
			});

			const early = ports({ settings: settings('17:45'), clock: clockAt(17 * 60 + 44) });
			await expect(dispatchDueReminders(early)).resolves.toMatchObject({ skipped: 'quiet_hours' });
			expect(early.whatsNext.loadItems).not.toHaveBeenCalled();

			const due = ports({ settings: settings('17:45'), clock: clockAt(17 * 60 + 45) });
			await expect(dispatchDueReminders(due)).resolves.toEqual({ sent: 1, failed: 0 });
			expect(due.channels.get).toHaveBeenCalledWith(channel);
		}
	);

	it('allows a reminder time earlier than the former fixed 08:00', async () => {
		const instance = ports({
			settings: {
				getSettings: () => ({
					enabled: true,
					channel: 'NTFY',
					selectedChannelConfigured: true,
					leadDays: 7,
					reminderTime: '06:30',
					minimalContent: false
				})
			},
			clock: {
				todayIso: () => '2026-06-03',
				nowIso: () => '2026-06-03T05:00:00.000Z',
				localHour: () => 6,
				localMinuteOfDay: () => 6 * 60 + 30
			}
		});
		await expect(dispatchDueReminders(instance)).resolves.toEqual({ sent: 1, failed: 0 });
	});

	it('does not load work when the selected channel is incomplete', async () => {
		const instance = ports({
			settings: {
				getSettings: () => ({
					enabled: true,
					channel: 'NTFY',
					selectedChannelConfigured: false,
					leadDays: 7,
					reminderTime: '08:00',
					minimalContent: false
				})
			}
		});
		await dispatchDueReminders(instance);
		expect(instance.whatsNext.loadItems).not.toHaveBeenCalled();
		expect(instance.channels.get).not.toHaveBeenCalled();
	});

	it.each([
		['DONE', [], null],
		['SKIPPED', [], null],
		['OPEN', ['OPEN'], '2026-06-10'],
		['OPEN', [], null]
	])('does not send ineligible work (%s)', async (state, dependencyStates, dueDate) => {
		const instance = ports({
			whatsNext: {
				loadItems: () =>
					[
						{
							itemId: 'item',
							title: 'Item',
							actions: [
								{
									actionId: 'action',
									label: 'Action',
									state: state as 'OPEN' | 'DONE' | 'SKIPPED',
									dueKind: 'MANUAL',
									dueDate,
									dueOverrideDate: null,
									position: 1,
									dependencyStates
								}
							]
						}
					] as WhatsNextItemInput[]
			}
		});
		await dispatchDueReminders(instance);
		expect(instance.channels.get).not.toHaveBeenCalled();
	});

	it('does not send when the delivery claim loses a race', async () => {
		const instance = ports({ deliveries: { ...ports().deliveries, claim: vi.fn(() => false) } });
		await dispatchDueReminders(instance);
		expect(instance.channels.get).not.toHaveBeenCalled();
	});

	it('processes the retry snapshot before claiming new work', async () => {
		const instance = ports();
		instance.deliveries.listRetryable.mockReturnValue([
			{
				actionId: 'action',
				kind: 'DUE_SOON',
				targetDate: '2026-06-10',
				channel: 'SLACK'
			}
		]);
		await dispatchDueReminders(instance);
		expect(instance.channels.get.mock.calls.map(([channel]) => channel)).toEqual(['SLACK', 'NTFY']);
	});

	it('does not send the same delivery twice when it appears in the retry snapshot', async () => {
		const instance = ports();
		instance.deliveries.listRetryable.mockReturnValue([
			{ actionId: 'action', kind: 'DUE_SOON', targetDate: '2026-06-10', channel: 'NTFY' }
		]);
		await dispatchDueReminders(instance);
		expect(instance.channels.get).toHaveBeenCalledTimes(1);
		expect(instance.deliveries.claim).not.toHaveBeenCalled();
	});

	it('does not retry a delivery that is no longer in Whats Next', async () => {
		const instance = ports({
			whatsNext: {
				loadItems: () => [
					{
						itemId: 'item',
						title: 'Item',
						actions: [
							{
								actionId: 'action',
								label: 'Action',
								state: 'OPEN',
								dueKind: 'DERIVED',
								dueDate: null,
								dueOverrideDate: '2026-06-10',
								position: 1,
								dependencyStates: []
							}
						]
					}
				]
			}
		});
		instance.deliveries.listRetryable.mockReturnValue([
			{ actionId: 'action', kind: 'DUE_SOON', targetDate: '2026-06-10', channel: 'SLACK' }
		]);
		await dispatchDueReminders(instance);
		expect(instance.channels.get).not.toHaveBeenCalled();
	});

	it('passes only current reminders to the bounded retry query', async () => {
		const instance = ports();
		await dispatchDueReminders(instance);
		expect(instance.deliveries.listRetryable).toHaveBeenCalledWith(3, 20, [
			expect.objectContaining({ actionId: 'action', kind: 'DUE_SOON', targetDate: '2026-06-10' })
		]);
	});

	it('records channel failures and continues with later reminders', async () => {
		const send = vi
			.fn()
			.mockRejectedValueOnce(new Error('http_502'))
			.mockResolvedValueOnce(undefined);
		const instance = ports({
			channels: { get: vi.fn(() => ({ send })) },
			whatsNext: {
				loadItems: () => [
					{
						itemId: 'item',
						title: 'Item',
						actions: [
							{
								actionId: 'first',
								label: 'First',
								state: 'OPEN',
								dueKind: 'MANUAL',
								dueDate: '2026-06-10',
								dueOverrideDate: null,
								position: 1,
								dependencyStates: []
							},
							{
								actionId: 'second',
								label: 'Second',
								state: 'OPEN',
								dueKind: 'MANUAL',
								dueDate: '2026-06-10',
								dueOverrideDate: null,
								position: 2,
								dependencyStates: []
							}
						]
					}
				]
			}
		});

		await expect(dispatchDueReminders(instance)).resolves.toEqual({ sent: 1, failed: 1 });
		expect(instance.deliveries.markAttemptFailed).toHaveBeenCalledWith(
			'first',
			'DUE_SOON',
			'2026-06-10',
			'NTFY',
			'http_502',
			3,
			'2026-06-03T09:00:00.000Z'
		);
	});
});
