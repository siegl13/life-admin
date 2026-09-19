import { describe, expect, it } from 'vitest';
import { selectChannel } from './selectChannel';

const ntfy = {
	channel: 'NTFY' as const,
	baseUrl: 'https://ntfy.example',
	topic: 'household_topic',
	token: null,
	webhookUrl: null
};

describe('selectChannel', () => {
	it('selects ntfy and Slack from the stored channel', () => {
		expect(selectChannel({}, ntfy)).not.toBeNull();
		expect(
			selectChannel(
				{},
				{ ...ntfy, channel: 'SLACK', webhookUrl: 'https://hooks.slack.com/services/a/b/c' }
			)
		).not.toBeNull();
	});

	it('uses the fake transport only outside production', () => {
		const fake = selectChannel({ LIFEADMIN_NOTIFY_FAKE: '1', NODE_ENV: 'test' }, ntfy);
		expect(fake).not.toBeNull();
		expect(selectChannel({ LIFEADMIN_NOTIFY_FAKE: '1', NODE_ENV: 'production' }, ntfy)).not.toBe(
			fake
		);
	});
});
