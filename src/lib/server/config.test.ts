import { afterEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from './config';

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe('AI run limit', () => {
	it('does not exhaust the shared E2E database with fake provider runs', async () => {
		vi.stubEnv('NODE_ENV', 'test');
		vi.stubEnv('LIFEADMIN_AI_FAKE', '1');
		vi.resetModules();
		expect((await import('./config')).config.aiDailyRunLimit).toBe(1000);
	});

	it('keeps the production quota even if the fake provider flag is present', async () => {
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('LIFEADMIN_AI_FAKE', '1');
		vi.resetModules();
		expect((await import('./config')).config.aiDailyRunLimit).toBe(20);
	});
});

describe('AI output token configuration', () => {
	it('defaults to an 8,000-token output budget', () => {
		expect(readConfig({}).aiMaxOutputTokens).toBe(8000);
	});

	it('accepts a positive integer override', () => {
		expect(readConfig({ LIFEADMIN_AI_MAX_OUTPUT_TOKENS: '12000' }).aiMaxOutputTokens).toBe(12000);
	});

	it.each(['0', '-1', '1.5', 'not-a-number'])(
		'uses the safe default for invalid value %s',
		(value) => {
			expect(readConfig({ LIFEADMIN_AI_MAX_OUTPUT_TOKENS: value }).aiMaxOutputTokens).toBe(8000);
		}
	);
});
