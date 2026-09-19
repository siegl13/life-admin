import { describe, expect, it } from 'vitest';
import { selectProvider } from './selectProvider';

describe('selectProvider', () => {
	it('selects the fake provider when LIFEADMIN_AI_FAKE=1 and NODE_ENV is not production', () => {
		const provider = selectProvider({ LIFEADMIN_AI_FAKE: '1', NODE_ENV: 'test' });
		expect(provider.providerId).toBe('fake');
	});

	it('selects the real (OpenAI) provider when LIFEADMIN_AI_FAKE=1 but NODE_ENV=production', () => {
		const provider = selectProvider({ LIFEADMIN_AI_FAKE: '1', NODE_ENV: 'production' });
		expect(provider.providerId).toBe('openai');
	});

	it('selects the real (OpenAI) provider when LIFEADMIN_AI_FAKE is unset', () => {
		const provider = selectProvider({ NODE_ENV: 'test' });
		expect(provider.providerId).toBe('openai');
	});
});
