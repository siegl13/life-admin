import { expect, test } from '@playwright/test';

test('setup is closed after the owner exists', async ({ page }) => {
	const response = await page.goto('/setup');
	expect(response?.status()).toBe(404);
});
