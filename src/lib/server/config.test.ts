import { afterEach, describe, expect, it, vi } from 'vitest';

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
