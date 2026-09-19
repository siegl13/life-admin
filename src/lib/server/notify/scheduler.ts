import { dispatchDueReminders } from '$lib/application/notify/dispatchDueReminders';
import {
	clock,
	notificationChannelsPort,
	notificationDeliveriesPort,
	notificationSettingsPort,
	whatsNextPort
} from '$lib/server/appPorts';
import { config } from '$lib/server/config';
import { getDb } from '$lib/server/db/database';
import { log } from '$lib/server/log';
import { isRestorePending } from '$lib/server/restoreState';
import { recordNotificationTick } from './notificationSettingsRepository';

const TICK_MS = 15 * 60 * 1000;
const FIRST_TICK_MS = 10 * 1000;
let started = false;

export function createNotificationTick(
	dispatch: () => Promise<{ sent: number; failed: number; skipped?: string }>,
	recordTick = (result: { skipped?: string }) => {
		if (!result.skipped) recordNotificationTick(getDb(), clock.nowIso());
	}
): () => void {
	let inFlight = false;
	return () => {
		if (inFlight) return;
		inFlight = true;
		void (async () => {
			try {
				if (isRestorePending()) return;
				const result = await dispatch();
				recordTick(result);
				if (result.sent || result.failed) log.info('notifications: tick', { ...result });
			} catch {
				log.error('notifications: tick failed', { reason: 'dispatch_failed' });
			} finally {
				inFlight = false;
			}
		})();
	};
}

export function startNotificationScheduler(): void {
	if (started || process.env.LIFEADMIN_DISABLE_SCHEDULER === '1') return;
	started = true;
	const tick = createNotificationTick(() =>
		dispatchDueReminders({
			settings: notificationSettingsPort,
			deliveries: notificationDeliveriesPort,
			channels: notificationChannelsPort,
			whatsNext: whatsNextPort,
			clock,
			origin: config.origin
		})
	);
	setTimeout(tick, FIRST_TICK_MS).unref();
	setInterval(tick, TICK_MS).unref();
}
