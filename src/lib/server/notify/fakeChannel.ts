import type { NotificationChannelPort } from '$lib/application/notify/ports';

export const fakeChannel: NotificationChannelPort = { async send(): Promise<void> {} };
