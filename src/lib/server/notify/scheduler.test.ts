import { afterEach, describe, expect, it, vi } from 'vitest';
import { latchRestorePending } from '$lib/server/restoreState';
import { buildNotificationMessage } from '$lib/application/notify/message';
import { setLocaleProvider } from '$lib/i18n';
import { getRequestLocale } from '$lib/server/i18n/requestLocale';
import { dispatchDueReminders } from '$lib/application/notify/dispatchDueReminders';
import { clock } from '$lib/server/appPorts';
import { createNotificationTick, scheduleMinuteTicks } from './scheduler';

// The same one-line wiring `hooks.server.ts` performs in production: reads
// the request-scoped locale `runWithLocale` sets, not a test-only constant.
setLocaleProvider(() => getRequestLocale() ?? 'de');

let storedLanguagePreference: string | null = null;

// Hoisted by vitest above these imports, so the real module (clock, ports,
// etc.) stays intact except for the one port createNotificationTick reads
// the saved UI language from.
vi.mock('$lib/server/appPorts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/appPorts')>();
	return {
		...actual,
		appSettingsPort: {
			get: vi.fn((key: string) => (key === 'ui.language' ? storedLanguagePreference : null)),
			set: vi.fn()
		}
	};
});

const reminder = {
	itemId: 'item-1',
	itemTitle: 'Electricity house',
	actionId: 'action-1',
	actionLabel: 'Send cancellation',
	kind: 'DUE_SOON' as const,
	targetDate: '2026-10-01'
};

describe('createNotificationTick', () => {
	afterEach(() => {
		storedLanguagePreference = null;
	});

	it.each([
		{ saved: 'de', expectedDate: '1. Oktober 2026' },
		{ saved: 'en', expectedDate: '1 October 2026' }
	])(
		'resolves the saved "$saved" preference through the scheduler locale context, formatting the notification body in that language',
		async ({ saved, expectedDate }) => {
			storedLanguagePreference = saved;
			let capturedBody: string | undefined;
			const dispatch = vi.fn().mockImplementation(async () => {
				// Built inside the tick's dispatch callback, i.e. under the
				// scheduler's own runWithLocale(locale, () => dispatch()) scope —
				// not substituted with a direct setLocaleProvider call.
				capturedBody = buildNotificationMessage(reminder, {
					minimalContent: false,
					origin: null
				}).body;
				return { sent: 0, failed: 0 };
			});
			const tick = createNotificationTick(dispatch, () => {});

			tick();
			// Flush the tick's internal async IIFE and the resolved dispatch call.
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(dispatch).toHaveBeenCalledTimes(1);
			expect(capturedBody).toContain(expectedDate);
		}
	);
	it('skips overlapping dispatches and permits the next completed tick', async () => {
		let resolveFirst!: (value: { sent: number; failed: number }) => void;
		const first = new Promise<{ sent: number; failed: number }>((resolve) => {
			resolveFirst = resolve;
		});
		const dispatch = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ sent: 0, failed: 0 });
		const tick = createNotificationTick(dispatch, () => {});

		tick();
		tick();
		expect(dispatch).toHaveBeenCalledTimes(1);

		resolveFirst!({ sent: 0, failed: 0 });
		await first;
		await Promise.resolve();
		tick();
		expect(dispatch).toHaveBeenCalledTimes(2);
	});

	describe('scheduleMinuteTicks with the real dispatcher', () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		function setup(reminderTime = '23:59') {
			const claimed = new Set<string>();
			const send = vi.fn(async () => {});
			const retryFlags: boolean[] = [];
			const listRetryable = vi.fn(() => []);
			const dispatchNow = (options: { retryFailed: boolean }) => {
				retryFlags.push(options.retryFailed);
				return dispatchDueReminders({
					settings: {
						getSettings: () => ({
							enabled: true,
							channel: 'NTFY' as const,
							selectedChannelConfigured: true,
							leadDays: 7,
							reminderTime,
							minimalContent: false
						})
					},
					deliveries: {
						claim: (input) => {
							const key = `${input.actionId}:${input.kind}:${input.targetDate}:${input.channel}`;
							if (claimed.has(key)) return false;
							claimed.add(key);
							return true;
						},
						markSent: vi.fn(),
						markSentAndConsumeSnooze: vi.fn(() => true),
						markAttemptFailed: vi.fn(),
						listRetryable,
						getLastFailure: vi.fn()
					},
					channels: { get: () => ({ send }) },
					whatsNext: {
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
					},
					clock,
					origin: null,
					retryFailed: options.retryFailed
				});
			};
			return {
				send,
				retryFlags,
				listRetryable,
				tick: createNotificationTick(dispatchNow, () => {})
			};
		}

		it('sends a 23:59 reminder once across midnight and repeated ticks', async () => {
			// Local 23:57:30: the first scheduler tick at 23:57:40 would have been
			// followed by 15-minute ticks at 00:12:40, never inside 23:59.
			vi.useFakeTimers({ now: new Date(2026, 5, 3, 23, 57, 30) });
			const { send, tick } = setup();
			const stop = scheduleMinuteTicks(tick);

			await vi.advanceTimersByTimeAsync(10_000 + 60_000); // 23:58:40
			expect(send).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(60_000); // 23:59:40 (tick at 23:59:01)
			expect(send).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(20 * 60_000); // past midnight, many ticks
			expect(new Date().getDate()).toBe(4);
			expect(send).toHaveBeenCalledTimes(1);
			stop();
		});

		it('retries failed deliveries only every 15th minute', async () => {
			vi.useFakeTimers({ now: new Date(2026, 5, 3, 23, 59, 30) });
			const { listRetryable, tick } = setup('00:00');
			const stop = scheduleMinuteTicks(tick);

			await vi.advanceTimersByTimeAsync(31 * 60_000);
			// 00:00:01 and 00:15:01 and 00:30:01 retry, plus the startup tick.
			expect(listRetryable.mock.calls.length).toBeLessThanOrEqual(4);
			expect(listRetryable.mock.calls.length).toBeGreaterThanOrEqual(3);
			stop();
		});
	});

	it('does not dispatch or reopen the database while restore is pending', async () => {
		latchRestorePending({ safetyBackup: 'pre-restore-test.zip' });
		const dispatch = vi.fn().mockResolvedValue({ sent: 0, failed: 0 });
		const recordTick = vi.fn();
		const tick = createNotificationTick(dispatch, recordTick);

		tick();
		await Promise.resolve();

		expect(dispatch).not.toHaveBeenCalled();
		expect(recordTick).not.toHaveBeenCalled();
	});
});
