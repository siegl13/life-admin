import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNtfyChannel } from './ntfyChannel';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('createNtfyChannel', () => {
	it('sends the configured headers without exposing the token in failures', async () => {
		const token = 'ntfy-secret-token';
		const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 });
		vi.stubGlobal('fetch', fetchMock);
		const channel = createNtfyChannel('https://ntfy.example', 'household_topic', token)!;

		await expect(channel.send({ title: 'Item', body: 'Action', clickUrl: null })).rejects.toThrow(
			'http_502'
		);
		expect(fetchMock).toHaveBeenCalledWith(
			'https://ntfy.example/household_topic',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: `Bearer ${token}` })
			})
		);
		await expect(
			channel.send({ title: 'Item', body: 'Action', clickUrl: null })
		).rejects.not.toThrow(token);
	});

	it('returns null without a topic', () => {
		expect(createNtfyChannel('https://ntfy.example', '', null)).toBeNull();
	});

	it('maps timeout and network failures to safe error codes without logging secrets', async () => {
		const token = 'ntfy-secret-token';
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new DOMException('request timed out', 'TimeoutError'))
			.mockRejectedValueOnce(new Error('network response contained ntfy-secret-token'));
		const timeoutSpy = vi
			.spyOn(AbortSignal, 'timeout')
			.mockReturnValue(new AbortController().signal);
		const consoleSpies = [
			vi.spyOn(console, 'error').mockImplementation(() => {}),
			vi.spyOn(console, 'warn').mockImplementation(() => {}),
			vi.spyOn(console, 'log').mockImplementation(() => {})
		];
		vi.stubGlobal('fetch', fetchMock);
		const channel = createNtfyChannel('https://ntfy.example', 'household_topic', token)!;

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
		const responseBody = 'ntfy-secret-token';
		const text = vi.fn().mockResolvedValue(responseBody);
		const consoleSpies = [
			vi.spyOn(console, 'error').mockImplementation(() => {}),
			vi.spyOn(console, 'warn').mockImplementation(() => {}),
			vi.spyOn(console, 'log').mockImplementation(() => {})
		];
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text }));
		const channel = createNtfyChannel('https://ntfy.example', 'household_topic', responseBody)!;

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
