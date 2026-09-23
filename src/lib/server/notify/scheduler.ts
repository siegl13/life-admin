import { dispatchDueReminders } from '$lib/application/notify/dispatchDueReminders';
import {
	appSettingsPort,
	clock,
	notificationChannelsPort,
	notificationDeliveriesPort,
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
				// No HTTP request (and so no Accept-Language) exists for a
				// background tick — "browser" mode falls back to English here,
				// the same bootstrap rule the restore-pending page uses.
				const locale = resolveEffectiveLocale(
					getLanguagePreference({ settings: appSettingsPort }),
					null
				);
				const result = await runWithLocale(locale, () => dispatch());
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
