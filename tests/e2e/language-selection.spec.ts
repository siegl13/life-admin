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

test('a formatted date on Item detail follows the selected UI language, not a fixed locale', async ({
	page
}) => {
	// Starts in browser mode, which this file pins to en-US (see test.use
	// above): English labels/formatting apply without an explicit switch.
	await page.goto('/items/new');
	await page.getByLabel('Title').fill(`Language format check ${Date.now()}`);
	await page.getByRole('button', { name: 'Create' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();

	const createdOn = page.locator('.page-head__context');
	// English: day, full month name, year, no trailing period after the day.
	await expect(createdOn).toHaveText(/^Created \d{1,2} \p{L}+ \d{4}$/u);

	await page.goto('/settings');
	await languageButton(page, 'de').click();
	await page.goto(itemUrl);
	await expect(page.locator('html')).toHaveAttribute('lang', 'de');
	// German: day with a trailing period, then month and year.
	await expect(createdOn).toHaveText(/^Angelegt \d{1,2}\. \p{L}+ \d{4}$/u);
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
