import type { NotificationChannelPort, NotificationMessage } from '$lib/application/notify/ports';

export function createNtfyChannel(
	baseUrl: string,
	topic: string,
	token: string | null
): NotificationChannelPort | null {
	if (!topic) return null;
	return {
		async send(message: NotificationMessage): Promise<void> {
			try {
				const response = await fetch(`${baseUrl}/${encodeURIComponent(topic)}`, {
					method: 'POST',
					body: message.body,
					headers: {
						Title: message.title,
						...(message.clickUrl ? { Click: message.clickUrl } : {}),
						...(token ? { Authorization: `Bearer ${token}` } : {})
					},
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
