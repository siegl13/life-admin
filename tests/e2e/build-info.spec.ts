import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Read via fs rather than `import ... from '../../package.json'`: Node's
// ESM loader (unlike Vite, which handles the app's own such imports)
// requires an import-attribute for JSON that varies across Node versions.
const packageJson = JSON.parse(
	readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
);

/**
 * The e2e webServer (playwright.config.ts) never sets APP_REVISION, the
 * same as a plain local `npm run build` — so both Settings and /healthz
 * are expected to show the "local" fallback here, not a real commit SHA.
 * Docker/CI injection is covered by build verification, not this suite.
 */
test('Settings shows the running version and the local-build fallback', async ({ page }) => {
	await page.goto('/settings');

	await expect(page.getByText(`Version ${packageJson.version}`)).toBeVisible();
	await expect(page.getByText('Build local')).toBeVisible();
});

test('authenticated /healthz reports version and revision, nothing else new', async ({
	request
}) => {
	const response = await request.get('/healthz');
	const body = await response.json();

	expect(body.version).toBe(packageJson.version);
	expect(body.revision).toBe('local');

	// Guards against a build/CI leak: no filesystem path, run id, username,
	// token, or branch name sneaking into a field this feature added.
	const serialized = JSON.stringify(body);
	expect(serialized).not.toMatch(/\/(home|Users|app|data)\//);
	expect(serialized.toLowerCase()).not.toMatch(/token|secret|password/);
});
