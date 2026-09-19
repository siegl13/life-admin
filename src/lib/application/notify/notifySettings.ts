import type { NotificationChannel } from './ports';

export const NOTIFY_KEYS = {
	enabled: 'notify.enabled',
	channel: 'notify.channel',
	baseUrl: 'notify.ntfy.baseUrl',
	topic: 'notify.ntfy.topic',
	leadDays: 'notify.leadDays',
	minimalContent: 'notify.minimalContent',
	lastTickAt: 'notify.lastTickAt',
	ntfyToken: 'secret.notify.ntfy.token',
	slackWebhook: 'secret.notify.slack.webhookUrl'
} as const;

export class InvalidNotificationSettingsError extends Error {
	constructor(readonly key: 'server' | 'topic' | 'webhook' | 'leadDays') {
		super(key);
	}
}

export function validateNotificationSettings(input: {
	channel: string;
	baseUrl: string;
	topic: string;
	webhookUrl: string;
	leadDays: string;
}): {
	channel: NotificationChannel;
	baseUrl: string;
	topic: string;
	webhookUrl: string;
	leadDays: number;
} {
	const channel = input.channel === 'SLACK' ? 'SLACK' : input.channel === 'NTFY' ? 'NTFY' : null;
	if (!channel) throw new InvalidNotificationSettingsError('server');
	let baseUrl: URL;
	try {
		baseUrl = new URL(input.baseUrl);
	} catch {
		throw new InvalidNotificationSettingsError('server');
	}
	if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:')
		throw new InvalidNotificationSettingsError('server');
	const topic = input.topic.trim();
	if (topic && !/^[A-Za-z0-9_-]{4,64}$/.test(topic))
		throw new InvalidNotificationSettingsError('topic');
	const webhookUrl = input.webhookUrl.trim();
	if (webhookUrl && !webhookUrl.startsWith('https://hooks.slack.com/services/'))
		throw new InvalidNotificationSettingsError('webhook');
	const leadDays = Number(input.leadDays);
	if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 90)
		throw new InvalidNotificationSettingsError('leadDays');
	return { channel, baseUrl: baseUrl.toString().replace(/\/$/, ''), topic, webhookUrl, leadDays };
}
