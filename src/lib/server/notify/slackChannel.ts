import type { NotificationChannelPort, NotificationMessage } from '$lib/application/notify/ports';

export function createSlackChannel(webhookUrl: string | null): NotificationChannelPort | null {
	if (!webhookUrl) return null;
	return {
		async send(message: NotificationMessage): Promise<void> {
			try {
				const response = await fetch(webhookUrl, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						text: [message.title, message.body, message.clickUrl].filter(Boolean).join('\n'),
						mrkdwn: false
					}),
					signal: AbortSignal.timeout(10_000)
				});
				if (!response.ok) throw new Error(`http_${response.status}`);
			} catch (error) {
				if (error instanceof Error && /^http_\d{3}$/.test(error.message)) throw error;
				if (error instanceof DOMException && error.name === 'TimeoutError')
					throw new Error('timeout', { cause: error });
				throw new Error('network_error', { cause: error });
			}
		}
	};
}
