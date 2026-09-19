import { expect, test } from '@playwright/test';

test('logout invalidates the current session', async ({ page }) => {
	await page.context().clearCookies();
	await page.goto('/login');
	await page.getByLabel('Benutzername').fill('owner');
	await page.getByLabel('Passwort').fill('correct horse battery staple');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.getByRole('button', { name: 'Abmelden' }).click();
	await expect(page).toHaveURL('/login');
	await page.goto('/items');
	await expect(page).toHaveURL(/\/login/);
});
