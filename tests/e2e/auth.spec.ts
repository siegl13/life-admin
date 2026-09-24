import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('anonymous routes require login and correct login keeps the target', async ({ page }) => {
	await page.goto('/items/new');
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Fitems%2Fnew/);
	await page.getByLabel('Benutzername').fill('owner');
	await page.getByLabel('Passwort').fill('wrong password');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page.getByText('Anmeldung fehlgeschlagen.')).toBeVisible();
	await page.getByLabel('Benutzername').fill('owner');
	await page.getByLabel('Passwort').fill('correct horse battery staple');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).toHaveURL('/items/new');
});

test('login page does not render the authenticated top bar or sign-out control', async ({
	page
}) => {
	await page.goto('/login');
	await expect(page.locator('.app-topbar')).toHaveCount(0);
	await expect(page.locator('.app-tabbar')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Abmelden' })).toHaveCount(0);
});

test('anonymous health response exposes only status', async ({ request }) => {
	const response = await request.get('/healthz');
	expect(await response.json()).toEqual({ status: 'ok' });
});

test('anonymous backup download redirects to login instead of returning archive bytes', async ({
	request
}) => {
	const response = await request.get('/settings/backup', { maxRedirects: 0 });
	expect(response.status()).toBe(303);
	expect(response.headers()['location']).toMatch(/^\/login\?redirectTo=/);
	expect(response.headers()['content-disposition']).toBeUndefined();
	const body = await response.body();
	expect(body.byteLength).toBe(0);
});

test('cross-origin plain form POST is rejected by SvelteKit origin checking', async ({
	request
}) => {
	const response = await request.post('/login', {
		headers: {
			origin: 'https://evil.example',
			'content-type': 'application/x-www-form-urlencoded'
		},
		data: 'username=owner&password=correct%20horse%20battery%20staple'
	});
	expect(response.status()).toBe(403);
});

test('authenticated HTML uses the same-origin referrer policy', async ({ browser }) => {
	const context = await browser.newContext({ storageState: '.data-e2e/playwright-auth.json' });
	const response = await context.request.get('/settings');
	expect(response.headers()['referrer-policy']).toBe('same-origin');
	await context.close();
});
