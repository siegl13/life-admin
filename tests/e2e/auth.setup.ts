import { test as setup, expect } from '@playwright/test';

setup('create owner account', async ({ page }) => {
	await page.goto('/setup');

	// Shared appearance, checked on the real Setup form while the owner
	// does not yet exist (afterwards /setup 404s, see setup-closed.spec.ts):
	// same page-head heading structure and 44px control heights as the
	// other auth pages.
	const heading = page.locator('.page-head h1');
	await expect(heading).toBeVisible();
	const controls = page.locator(
		'input[type="text"], input[type="password"], button[type="submit"]'
	);
	const controlCount = await controls.count();
	for (let i = 0; i < controlCount; i++) {
		const height = await controls.nth(i).evaluate((node) => node.getBoundingClientRect().height);
		expect(height).toBeGreaterThanOrEqual(44);
	}

	await page.getByLabel('Benutzername').fill('owner');
	await page.getByLabel('Passwort', { exact: true }).fill('correct horse battery staple');
	await page
		.getByLabel('Passwort wiederholen', { exact: true })
		.fill('correct horse battery staple');
	await page.getByRole('button', { name: 'Konto erstellen' }).click();
	await expect(page).toHaveURL('/');
	await page.context().storageState({ path: '.data-e2e/playwright-auth.json' });
});
