import { expect, test } from '@playwright/test';

/**
 * Regression guard: the settings page must render each playbook's
 * locale-resolved German label (`label_i18n.de`), not its English base
 * `name`. A prior bug dropped `labelI18n` from the page's load function,
 * so the page silently fell back to the base label with no error.
 */
test('settings page shows playbook names in German, not the English base label', async ({
	page
}) => {
	await page.goto('/settings');

	await expect(page.getByText('TÜV / Hauptuntersuchung')).toBeVisible();
	await expect(page.getByText('Vehicle inspection (TÜV / HU)')).toHaveCount(0);
});
