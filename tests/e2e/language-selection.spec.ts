import { expect, test } from '@playwright/test';

// Pins the browser's Accept-Language so "browser mode" resolves
// deterministically to English regardless of the host machine's locale
// (the rest of the suite pins German in playwright.config.ts).
test.use({ locale: 'en-US' });

function languageButton(page: import('@playwright/test').Page, value: 'browser' | 'de' | 'en') {
	return page.locator(`#g-language form button[value="${value}"]`);
}

test.afterEach(async ({ page }) => {
	// Reset to the default so other specs (which assume German/browser
	// behavior) are unaffected by this spec's language changes. Value-based
	// locators, not translated text, so this works regardless of the
	// language active when the test ends.
	await page.goto('/settings');
	await languageButton(page, 'browser').click();
});

test('Settings -> change language -> save -> UI changes -> persisted selection visible', async ({
	page
}) => {
	await page.goto('/settings');
	await expect(page.locator('#g-language')).toBeVisible();

	// Switch to English.
	await languageButton(page, 'en').click();
	await expect(page).toHaveURL('/settings');
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
	await expect(languageButton(page, 'en')).toHaveAttribute('aria-pressed', 'true');

	// The change is visible elsewhere in the app too, not just Settings.
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page.getByRole('link', { name: "What's next" })).toBeVisible();

	// Return to Settings: the persisted selection is still shown as active.
	await page.goto('/settings');
	await expect(languageButton(page, 'en')).toHaveAttribute('aria-pressed', 'true');

	// Switch to German.
	await languageButton(page, 'de').click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'de');
	await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true })).toBeVisible();

	// Switch back to browser mode: the pinned en-US Accept-Language applies
	// again.
	await languageButton(page, 'browser').click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('changing UI language does not change playbook country/domain selection', async ({ page }) => {
	await page.goto('/settings');
	const tuvRow = page.locator('#g-playbook-de\\.vehicle\\.tuv');
	await expect(tuvRow).toBeVisible();

	await languageButton(page, 'en').click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');

	// The German bundled playbook is still installed and listed after the
	// UI language switch: only its displayed name may follow the existing
	// label_i18n mechanism, never its presence or underlying country/domain
	// content.
	await expect(tuvRow).toBeVisible();
});
