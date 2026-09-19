import { buildDueReminders, type Reminder } from '$lib/domain/notify/reminders';
import { buildWhatsNext } from '$lib/domain/whatsnext/whatsNext';
import type { Clock, WhatsNextRepositoryPort } from '$lib/application/ports';
import { buildNotificationMessage } from './message';
import type {
	NotificationChannelsPort,
	NotificationDeliveryRepositoryPort,
	NotificationSettingsPort
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
	channels: NotificationChannelsPort;
	whatsNext: WhatsNextRepositoryPort;
	clock: Clock;
	origin: string | null;
}): Promise<DispatchResult> {
	const settings = ports.settings.getSettings();
	if (!settings.enabled || !settings.selectedChannelConfigured)
		return { skipped: 'disabled', sent: 0, failed: 0 };
	if (ports.clock.localHour() < 8) return { skipped: 'quiet_hours', sent: 0, failed: 0 };

	let sent = 0;
	let failed = 0;
	const send = async (reminder: Reminder, channel: typeof settings.channel) => {
		const adapter = ports.channels.get(channel);
		try {
			if (!adapter) throw new Error('not_configured');
			await adapter.send(
				buildNotificationMessage(reminder, {
					minimalContent: settings.minimalContent,
					origin: ports.origin
				})
			);
			ports.deliveries.markSent(
				reminder.actionId,
				reminder.kind,
				reminder.targetDate,
				channel,
				ports.clock.nowIso()
			);
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

	const today = ports.clock.todayIso();
	const reminders = buildDueReminders(
		buildWhatsNext(ports.whatsNext.loadItems(), today).flatMap((group) =>
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
	const reminderByKey = new Map(
		reminders.map((reminder) => [
			`${reminder.actionId}:${reminder.kind}:${reminder.targetDate}`,
			reminder
		])
	);
	const retrySnapshot = ports.deliveries.listRetryable(MAX_ATTEMPTS, RETRY_LIMIT, reminders);
	const retriedKeys = new Set(
		retrySnapshot.map(
			(retry) => `${retry.actionId}:${retry.kind}:${retry.targetDate}:${retry.channel}`
		)
	);
	for (const retry of retrySnapshot) {
		const reminder = reminderByKey.get(`${retry.actionId}:${retry.kind}:${retry.targetDate}`);
		if (reminder) await send(reminder, retry.channel);
	}
	for (const reminder of reminders) {
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
			await send(reminder, settings.channel);
		}
	}
	return { sent, failed };
}
