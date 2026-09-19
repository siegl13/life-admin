import { expect, test } from '@playwright/test';

/**
 * Regression guard: the item detail page's workflow timeline must give a
 * blocked step a reason that matches its actual cause. An unresolved
 * DERIVED action (its date can't be calculated yet) must never be
 * described the same way as an action genuinely waiting on another
 * action to finish.
 */

test('a DERIVED action with a missing source date names the missing field, not "an earlier step"', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Strom Wohnung');
	await page.getByLabel('Vorlage').selectOption({ label: 'Stromvertrag' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	// contract_end is left empty: check_tariff is DERIVED from it and
	// cannot be scheduled yet.
	const step = page.locator('.timeline__step', { hasText: 'Tarif prüfen' });
	await expect(step.getByText('Vertragsende fehlt')).toBeVisible();
	await expect(step.getByText('Vertragsende ergänzen, um den Termin zu berechnen.')).toBeVisible();
	await expect(step.getByText('Wartet auf einen vorherigen Schritt.')).toHaveCount(0);
});

test('an action blocked by a real dependency names the blocking action', async ({ page }) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('NV-Bescheinigung Blocked-Check');
	await page.getByLabel('Vorlage').selectOption({ label: 'NV-Bescheinigung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	// check_receipt depends on request_new, which is still open — a real
	// dependency, not a missing date.
	const step = page.locator('.timeline__step', { hasText: 'Eingang prüfen' });
	await expect(step.getByText('Wartet auf „Neue NV-Bescheinigung beantragen“')).toBeVisible();
	await expect(step.getByText('fehlt')).toHaveCount(0);
});
