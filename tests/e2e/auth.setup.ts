import { test as setup, expect } from '@playwright/test';

setup('create owner account', async ({ page }) => {
	await page.goto('/setup');
	await page.getByLabel('Benutzername').fill('owner');
	await page.getByLabel('Passwort', { exact: true }).fill('correct horse battery staple');
	await page
		.getByLabel('Passwort wiederholen', { exact: true })
		.fill('correct horse battery staple');
	await page.getByRole('button', { name: 'Konto erstellen' }).click();
	await expect(page).toHaveURL('/');
	await page.context().storageState({ path: '.data-e2e/playwright-auth.json' });
});
