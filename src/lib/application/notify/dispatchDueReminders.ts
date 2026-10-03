import { buildDueReminders, type Reminder } from '$lib/domain/notify/reminders';
import { buildWhatsNext } from '$lib/domain/whatsnext/whatsNext';
import { compareIsoDate } from '$lib/domain/date/isoDate';
import type { Clock, WhatsNextRepositoryPort } from '$lib/application/ports';
import { buildNotificationMessage } from './message';
import type { NotificationSnooze } from '$lib/domain/notify/snooze';
import type {
	NotificationChannelsPort,
	NotificationDeliveryRepositoryPort,
	NotificationSettingsPort,
	NotificationSnoozePort
} from './ports';

const MAX_ATTEMPTS = 3;
const RETRY_LIMIT = 20;

export interface DispatchResult {
	skipped?: 'disabled' | 'quiet_hours';
	sent: number;
	failed: number;
}

function shortReason(error: unknown): string {
	return error instanceof Error && /^[a-z0-9_]{1,32}$/.test(error.message)
		? error.message
		: 'send_failed';
}

export async function dispatchDueReminders(ports: {
	settings: NotificationSettingsPort;
	deliveries: NotificationDeliveryRepositoryPort;
	snoozes?: NotificationSnoozePort;
	channels: NotificationChannelsPort;
	whatsNext: WhatsNextRepositoryPort;
	clock: Clock;
	origin: string | null;
}): Promise<DispatchResult> {
	const settings = ports.settings.getSettings();
	ports.snoozes?.clearIneligible?.();
	if (!settings.enabled || !settings.selectedChannelConfigured)
		return { skipped: 'disabled', sent: 0, failed: 0 };
	if (ports.clock.localHour() < 8) return { skipped: 'quiet_hours', sent: 0, failed: 0 };

	const today = ports.clock.todayIso();
	const groups = buildWhatsNext(ports.whatsNext.loadItems(), today);
	const reminders = buildDueReminders(
		groups.flatMap((group) =>
			group.actions.map((action) => ({
				itemId: group.itemId,
				itemTitle: group.title,
				actionId: action.actionId,
				actionLabel: action.label,
				dueDate: action.dueDate,
				bucket: action.bucket,
				leadDays: settings.leadDays
			}))
		),
		today
	);
	const eligibleActions = new Map(
		groups.flatMap((group) =>
			group.actions.map((action) => [
				action.actionId,
				{ ...action, itemId: group.itemId, itemTitle: group.title }
			])
		)
	);
	const suppressedActions = new Set<string>();
	const activeSnoozes: Array<{ snooze: NotificationSnooze }> = [];
	for (const snooze of ports.snoozes?.list() ?? []) {
		const action = eligibleActions.get(snooze.actionId);
		suppressedActions.add(snooze.actionId);
		if (!action || action.dueDate === null || action.dueDate !== snooze.sourceDueDate) {
			ports.snoozes?.clearIfVersion(snooze.actionId, snooze.version);
			continue;
		}
		activeSnoozes.push({ snooze });
	}

	let sent = 0;
	let failed = 0;
	const send = async (
		reminder: Reminder,
		channel: typeof settings.channel,
		snoozeVersion?: string
	) => {
		const adapter = ports.channels.get(channel);
		try {
			if (!adapter) throw new Error('not_configured');
			await adapter.send(
				buildNotificationMessage(reminder, {
					minimalContent: settings.minimalContent,
					origin: ports.origin
				})
			);
			if (reminder.kind === 'SNOOZED') {
				if (!snoozeVersion) return;
				ports.deliveries.markSentAndConsumeSnooze({
					actionId: reminder.actionId,
					targetDate: reminder.targetDate,
					channel,
					nowIso: ports.clock.nowIso(),
					version: snoozeVersion
				});
			} else {
				ports.deliveries.markSent(
					reminder.actionId,
					reminder.kind,
					reminder.targetDate,
					channel,
					ports.clock.nowIso()
				);
			}
			sent++;
		} catch (error) {
			ports.deliveries.markAttemptFailed(
				reminder.actionId,
				reminder.kind,
				reminder.targetDate,
				channel,
				shortReason(error),
				MAX_ATTEMPTS,
				ports.clock.nowIso()
			);
			failed++;
		}
	};

	const snoozeVersions = new Map<string, string>();
	const snoozedReminders: Reminder[] = [];
	for (const { snooze } of activeSnoozes) {
		const action = eligibleActions.get(snooze.actionId);
		if (!action) continue;
		if (compareIsoDate(snooze.snoozedUntil, today) > 0) continue;
		snoozeVersions.set(snooze.actionId, snooze.version);
		snoozedReminders.push({
			itemId: action.itemId,
			itemTitle: action.itemTitle,
			actionId: action.actionId,
			actionLabel: action.label,
			kind: 'SNOOZED',
			targetDate: snooze.snoozedUntil
		});
	}
	const activeReminders = reminders.filter((reminder) => !suppressedActions.has(reminder.actionId));
	const allReminders = [...activeReminders, ...snoozedReminders];
	const reminderByKey = new Map(
		allReminders.map((reminder) => [
			`${reminder.actionId}:${reminder.kind}:${reminder.targetDate}`,
			reminder
		])
	);
	const retrySnapshot = ports.deliveries.listRetryable(MAX_ATTEMPTS, RETRY_LIMIT, allReminders);
	const retriedKeys = new Set(
		retrySnapshot.map(
			(retry) => `${retry.actionId}:${retry.kind}:${retry.targetDate}:${retry.channel}`
		)
	);
	for (const retry of retrySnapshot) {
		const reminder = reminderByKey.get(`${retry.actionId}:${retry.kind}:${retry.targetDate}`);
		if (reminder) await send(reminder, retry.channel, snoozeVersions.get(reminder.actionId));
	}
	for (const reminder of allReminders) {
		if (
			retriedKeys.has(
				`${reminder.actionId}:${reminder.kind}:${reminder.targetDate}:${settings.channel}`
			)
		)
			continue;
		if (
			ports.deliveries.claim({
				...reminder,
				channel: settings.channel,
				createdAt: ports.clock.nowIso()
			})
		) {
			await send(reminder, settings.channel, snoozeVersions.get(reminder.actionId));
		}
	}
	return { sent, failed };
}
