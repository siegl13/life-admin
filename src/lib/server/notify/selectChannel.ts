import type { NotificationChannel, NotificationChannelPort } from '$lib/application/notify/ports';
import { log } from '../log';
import { fakeChannel } from './fakeChannel';
import { createNtfyChannel } from './ntfyChannel';
import { createSlackChannel } from './slackChannel';

export function selectChannel(
	env: NodeJS.ProcessEnv,
	input: {
		channel: NotificationChannel;
		baseUrl: string;
		topic: string;
		token: string | null;
		webhookUrl: string | null;
	}
): NotificationChannelPort | null {
	if (env.LIFEADMIN_NOTIFY_FAKE === '1' && env.NODE_ENV !== 'production') {
		log.warn('notifications: using fake transport');
		return fakeChannel;
	}
	if (env.LIFEADMIN_NOTIFY_FAKE === '1')
		log.warn('notifications: fake transport ignored in production');
	return input.channel === 'NTFY'
		? createNtfyChannel(input.baseUrl, input.topic, input.token)
		: createSlackChannel(input.webhookUrl);
}
