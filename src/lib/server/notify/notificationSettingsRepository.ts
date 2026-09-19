import type Database from 'better-sqlite3';
import type { NotificationSettings } from '$lib/application/notify/ports';
import { NOTIFY_KEYS } from '$lib/application/notify/notifySettings';
import * as settings from '../db/repositories/appSettingsRepository';

export interface StoredNotificationSettings extends NotificationSettings {
	baseUrl: string;
	topic: string;
	tokenSet: boolean;
	webhookSet: boolean;
}

export function getNotificationSettings(db: Database.Database): StoredNotificationSettings {
	const channel = settings.get(db, NOTIFY_KEYS.channel) === 'SLACK' ? 'SLACK' : 'NTFY';
	const tokenSet = settings.get(db, NOTIFY_KEYS.ntfyToken) !== null;
	const webhookSet = settings.get(db, NOTIFY_KEYS.slackWebhook) !== null;
	return {
		enabled: settings.get(db, NOTIFY_KEYS.enabled) === '1',
		channel,
		selectedChannelConfigured:
			channel === 'NTFY' ? Boolean(settings.get(db, NOTIFY_KEYS.topic)?.trim()) : webhookSet,
		leadDays: Number(settings.get(db, NOTIFY_KEYS.leadDays) ?? '7'),
		minimalContent: settings.get(db, NOTIFY_KEYS.minimalContent) === '1',
		baseUrl: settings.get(db, NOTIFY_KEYS.baseUrl) ?? 'https://ntfy.sh',
		topic: settings.get(db, NOTIFY_KEYS.topic) ?? '',
		tokenSet,
		webhookSet
	};
}

export function getDispatchNotificationSettings(db: Database.Database): NotificationSettings {
	if (settings.get(db, NOTIFY_KEYS.enabled) !== '1') {
		return {
			enabled: false,
			channel: 'NTFY',
			selectedChannelConfigured: false,
			leadDays: 7,
			minimalContent: false
		};
	}
	const channel = settings.get(db, NOTIFY_KEYS.channel) === 'SLACK' ? 'SLACK' : 'NTFY';
	return {
		enabled: true,
		channel,
		selectedChannelConfigured:
			channel === 'NTFY'
				? Boolean(settings.get(db, NOTIFY_KEYS.topic)?.trim())
				: settings.get(db, NOTIFY_KEYS.slackWebhook) !== null,
		leadDays: Number(settings.get(db, NOTIFY_KEYS.leadDays) ?? '7'),
		minimalContent: settings.get(db, NOTIFY_KEYS.minimalContent) === '1'
	};
}

export function getNotificationLastTick(db: Database.Database): string | null {
	return settings.get(db, NOTIFY_KEYS.lastTickAt);
}

export function recordNotificationTick(db: Database.Database, nowIso: string): void {
	settings.set(db, NOTIFY_KEYS.lastTickAt, nowIso);
}

export function getSecret(
	db: Database.Database,
	key: typeof NOTIFY_KEYS.ntfyToken | typeof NOTIFY_KEYS.slackWebhook
): string | null {
	return settings.get(db, key);
}

export function saveNotificationSettings(
	db: Database.Database,
	input: {
		enabled: boolean;
		channel: 'NTFY' | 'SLACK';
		baseUrl: string;
		topic: string;
		leadDays: number;
		minimalContent: boolean;
		token: string;
		webhookUrl: string;
		removeToken: boolean;
		removeWebhook: boolean;
	}
): void {
	settings.set(db, NOTIFY_KEYS.enabled, input.enabled ? '1' : '0');
	settings.set(db, NOTIFY_KEYS.channel, input.channel);
	settings.set(db, NOTIFY_KEYS.baseUrl, input.baseUrl);
	settings.set(db, NOTIFY_KEYS.topic, input.topic);
	settings.set(db, NOTIFY_KEYS.leadDays, String(input.leadDays));
	settings.set(db, NOTIFY_KEYS.minimalContent, input.minimalContent ? '1' : '0');
	if (input.removeToken) settings.remove(db, NOTIFY_KEYS.ntfyToken);
	else if (input.token) settings.set(db, NOTIFY_KEYS.ntfyToken, input.token);
	if (input.removeWebhook) settings.remove(db, NOTIFY_KEYS.slackWebhook);
	else if (input.webhookUrl) settings.set(db, NOTIFY_KEYS.slackWebhook, input.webhookUrl);
}
