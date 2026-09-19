import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSlackChannel } from './slackChannel';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('createSlackChannel', () => {
	it('includes the item URL only when the message supplies one', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal('fetch', fetchMock);
		const channel = createSlackChannel('https://hooks.slack.com/services/a/b/c');
		await channel!.send({
			title: 'Item',
			body: 'Action',
			clickUrl: 'https://life.example/items/1'
		});

		expect(fetchMock).toHaveBeenCalledWith(
			'https://hooks.slack.com/services/a/b/c',
			expect.objectContaining({
				body: JSON.stringify({
					text: 'Item\nAction\nhttps://life.example/items/1',
					mrkdwn: false
				})
			})
		);
	});

	it('returns a safe HTTP code without exposing the webhook', async () => {
		const webhook = 'https://hooks.slack.com/services/secret/a/b';
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));
		const channel = createSlackChannel(webhook)!;

		await expect(channel.send({ title: 'Item', body: 'Action', clickUrl: null })).rejects.toThrow(
			'http_502'
		);
		await expect(
			channel.send({ title: 'Item', body: 'Action', clickUrl: null })
		).rejects.not.toThrow(webhook);
	});

	it('maps timeout and network failures to safe error codes without logging the webhook', async () => {
		const webhook = 'https://hooks.slack.com/services/secret/a/b';
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new DOMException('request timed out', 'TimeoutError'))
			.mockRejectedValueOnce(new Error(`network response contained ${webhook}`));
		const timeoutSpy = vi
			.spyOn(AbortSignal, 'timeout')
			.mockReturnValue(new AbortController().signal);
		const consoleSpies = [
			vi.spyOn(console, 'error').mockImplementation(() => {}),
			vi.spyOn(console, 'warn').mockImplementation(() => {}),
			vi.spyOn(console, 'log').mockImplementation(() => {})
		];
		vi.stubGlobal('fetch', fetchMock);
		const channel = createSlackChannel(webhook)!;

		await expect(channel.send({ title: 'Item', body: 'Action', clickUrl: null })).rejects.toThrow(
			'timeout'
		);
		await expect(channel.send({ title: 'Item', body: 'Action', clickUrl: null })).rejects.toThrow(
			'network_error'
		);
		expect(timeoutSpy).toHaveBeenCalledWith(10_000);
		consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
	});

	it('does not expose response bodies in HTTP failures or logs', async () => {
		const responseBody = 'slack-webhook-response-secret';
		const text = vi.fn().mockResolvedValue(responseBody);
		const consoleSpies = [
			vi.spyOn(console, 'error').mockImplementation(() => {}),
			vi.spyOn(console, 'warn').mockImplementation(() => {}),
			vi.spyOn(console, 'log').mockImplementation(() => {})
		];
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text }));
		const channel = createSlackChannel('https://hooks.slack.com/services/a/b/c')!;

		await expect(channel.send({ title: 'Item', body: 'Action', clickUrl: null })).rejects.toThrow(
			'http_500'
		);
		await expect(
			channel.send({ title: 'Item', body: 'Action', clickUrl: null })
		).rejects.not.toThrow(responseBody);
		expect(text).not.toHaveBeenCalled();
		consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
	});
});
