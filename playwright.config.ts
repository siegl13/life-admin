import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	globalSetup: './tests/e2e/global-setup.ts',
	fullyParallel: false,
	workers: 1,
	// Shared CI runners occasionally add enough latency to a single
	// otherwise-correct request (e.g. item creation) to trip the default
	// expect timeout. Retry on CI only, never locally.
	retries: process.env.CI ? 2 : 0,
	reporter: 'list',
	projects: [
		{ name: 'setup', testMatch: /auth\.setup\.ts/ },
		{
			name: 'chromium',
			dependencies: ['setup'],
			testIgnore: /auth\.setup\.ts/,
			use: { storageState: '.data-e2e/playwright-auth.json' }
		}
	],
	use: {
		baseURL: 'http://127.0.0.1:4173',
		trace: 'retain-on-failure',
		// Existing specs assume the pre-language-selection default (German
		// UI). Language mode defaults to "browser", so the suite must pin a
		// deterministic Accept-Language; specs covering the language switch
		// itself override this per-file (see language-selection.spec.ts).
		locale: 'de-DE'
	},
	webServer: {
		command: 'node build',
		port: 4173,
		env: {
			PORT: '4173',
			LIFEADMIN_DATA_DIR: '.data-e2e',
			// Required by adapter-node's CSRF origin check (defaults to
			// assuming HTTPS otherwise) — must match baseURL exactly, or
			// every form-based test fails with a 403.
			ORIGIN: 'http://127.0.0.1:4173',
			BODY_SIZE_LIMIT: '280M',
			// Deterministic fake provider: NODE_ENV is not 'production' here, so
			// the gate in selectProvider.ts opens. No document ever leaves this
			// machine and no real key is required — see selectProvider.test.ts.
			LIFEADMIN_AI_FAKE: '1',
			LIFEADMIN_OPENAI_API_KEY: 'test-key-not-used',
			LIFEADMIN_DISABLE_SCHEDULER: '1',
			LIFEADMIN_NOTIFY_FAKE: '1'
		},
		reuseExistingServer: false,
		timeout: 30_000
	}
});
