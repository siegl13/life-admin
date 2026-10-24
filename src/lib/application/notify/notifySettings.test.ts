import { describe, expect, it } from 'vitest';
import { InvalidNotificationSettingsError, validateNotificationSettings } from './notifySettings';

describe('validateNotificationSettings', () => {
	const valid = {
		channel: 'NTFY',
		baseUrl: 'https://ntfy.example',
		topic: 'private_topic',
		webhookUrl: '',
		leadDays: '7',
		reminderTime: '08:00'
	};

	it('accepts a valid ntfy configuration', () => {
		expect(validateNotificationSettings(valid)).toMatchObject({
			channel: 'NTFY',
			baseUrl: 'https://ntfy.example',
			topic: 'private_topic',
			leadDays: 7
		});
	});

	it('accepts whole-minute reminder times and rejects anything else', () => {
		expect(validateNotificationSettings({ ...valid, reminderTime: ' 17:45 ' })).toMatchObject({
			reminderTime: '17:45'
		});
		for (const reminderTime of ['', '25:00', '08:60', '8:00', '08:00:30', 'noon']) {
			expect(() => validateNotificationSettings({ ...valid, reminderTime })).toThrow(
				InvalidNotificationSettingsError
			);
		}
	});

	it('rejects unsafe server URLs and invalid topic lengths', () => {
		expect(() => validateNotificationSettings({ ...valid, baseUrl: 'file:///tmp/x' })).toThrow(
			InvalidNotificationSettingsError
		);
		expect(() => validateNotificationSettings({ ...valid, topic: 'abc' })).toThrow(
			InvalidNotificationSettingsError
		);
	});

	it('accepts only Slack service webhooks', () => {
		expect(() =>
			validateNotificationSettings({
				...valid,
				channel: 'SLACK',
				webhookUrl: 'https://example.test/hook'
			})
		).toThrow(InvalidNotificationSettingsError);
		expect(
			validateNotificationSettings({
				...valid,
				channel: 'SLACK',
				webhookUrl: 'https://hooks.slack.com/services/a/b/c'
			})
		).toMatchObject({ channel: 'SLACK' });
	});
});
