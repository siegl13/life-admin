import { dispatchDueReminders } from '$lib/application/notify/dispatchDueReminders';
import {
	appSettingsPort,
	clock,
	notificationChannelsPort,
	notificationDeliveriesPort,
	notificationSnoozesPort,
	notificationSettingsPort,
	whatsNextPort
} from '$lib/server/appPorts';
import { getLanguagePreference } from '$lib/application/settings/language';
import { resolveEffectiveLocale } from '$lib/domain/i18n/resolveLocale';
import { runWithLocale } from '$lib/server/i18n/requestLocale';
import { config } from '$lib/server/config';
import { getDb } from '$lib/server/db/database';
import { log } from '$lib/server/log';
import { isRestorePending } from '$lib/server/restoreState';
import { recordNotificationTick } from './notificationSettingsRepository';

const MINUTE_MS = 60 * 1000;
// Offset past the minute boundary so the local clock already reads the new minute.
const TICK_OFFSET_MS = 1000;
const RETRY_EVERY_MINUTES = 15;
const FIRST_TICK_MS = 10 * 1000;
let started = false;

export interface TickOptions {
	retryFailed: boolean;
}

export function createNotificationTick(
	dispatch: (options: TickOptions) => Promise<{ sent: number; failed: number; skipped?: string }>,
	recordTick = (result: { skipped?: string }) => {
		if (!result.skipped) recordNotificationTick(getDb(), clock.nowIso());
	}
): (options?: TickOptions) => void {
	let inFlight = false;
	return (options = { retryFailed: true }) => {
		if (inFlight) return;
		inFlight = true;
		void (async () => {
			try {
				if (isRestorePending()) return;
				// No HTTP request (and so no Accept-Language) exists for a
				// background tick — "browser" mode falls back to English here,
				// the same bootstrap rule the restore-pending page uses.
				const locale = resolveEffectiveLocale(
					getLanguagePreference({ settings: appSettingsPort }),
					null
				);
				const result = await runWithLocale(locale, () => dispatch(options));
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

/**
 * Ticks once at startup and then at the start of every local minute, so each
 * selectable whole-minute reminder time (including 23:59) is visited whatever
 * the startup phase. Failed deliveries are retried on every 15th minute only.
 * Duplicate sends are prevented by the delivery claim, not by tick spacing.
 */
export function scheduleMinuteTicks(tick: (options: TickOptions) => void): () => void {
	let timer: ReturnType<typeof setTimeout>;
	let stopped = false;
	const scheduleNext = () => {
		const now = Date.now();
		const delay = MINUTE_MS - (now % MINUTE_MS) + TICK_OFFSET_MS;
		timer = setTimeout(() => {
			if (stopped) return;
			tick({ retryFailed: new Date().getMinutes() % RETRY_EVERY_MINUTES === 0 });
			scheduleNext();
		}, delay);
		timer.unref();
	};
	timer = setTimeout(() => {
		if (stopped) return;
		tick({ retryFailed: true });
		scheduleNext();
	}, FIRST_TICK_MS);
	timer.unref();
	return () => {
		stopped = true;
		clearTimeout(timer);
	};
}

export function startNotificationScheduler(): void {
	if (started || process.env.LIFEADMIN_DISABLE_SCHEDULER === '1') return;
	started = true;
	const tick = createNotificationTick(({ retryFailed }) =>
		dispatchDueReminders({
			settings: notificationSettingsPort,
			deliveries: notificationDeliveriesPort,
			snoozes: notificationSnoozesPort,
			channels: notificationChannelsPort,
			whatsNext: whatsNextPort,
			clock,
			origin: config.origin,
			retryFailed
		})
	);
	scheduleMinuteTicks(tick);
}
