import { expect, test } from '@playwright/test';

/**
 * Slice 4 gate: the complex, multi-step workflow. Only the first
 * available action of the dependency chain (request_new) is shown
 * initially; completing it activates the next step
 * (check_receipt) — proving the workflow comes entirely from playbook
 * data, not from any NV-specific code.
 */
test('NV certificate: only the first workflow step is available, completing it activates the next', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('NV-Bescheinigung Max');
	await page.getByLabel('Vorlage').selectOption({ label: 'NV-Bescheinigung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	// Past expiry date so the first step is immediately due.
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2020-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	await page.goto('/');
	const group = page.locator('.item-group', { hasText: 'NV-Bescheinigung Max' });

	// Only the first step is visible; the later steps are not yet
	// available (they depend on this one), so they must not appear.
	await expect(group.getByText('Neue NV-Bescheinigung beantragen')).toBeVisible();
	await expect(group.getByText('Eingang prüfen')).toHaveCount(0);
	await expect(group.getByText('An Banken weiterleiten')).toHaveCount(0);

	await group.getByRole('button', { name: 'Erledigen' }).click();

	// Completing the first step activates the next one; item context
	// remains visible throughout, and What's Next never shows the whole
	// remaining chain at once.
	await expect(group.getByText('Neue NV-Bescheinigung beantragen')).toHaveCount(0);
	await expect(group.getByText('Eingang prüfen')).toBeVisible();
	await expect(group.getByText('An Banken weiterleiten')).toHaveCount(0);
});
