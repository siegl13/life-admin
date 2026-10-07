import { expect, test } from '@playwright/test';

async function openFieldsForEdit(page: import('@playwright/test').Page) {
	const panel = page.locator('details.fields-panel').filter({ has: page.locator('#fields-label') });
	if (!(await panel.evaluate((node) => node instanceof HTMLDetailsElement && node.open))) {
		await panel.locator(':scope > summary').click();
	}
	await expect(panel).toHaveAttribute('open', '');
	return panel;
}

/**
 * `currency` is a normal, generic Custom Field type (AI Extraction 1.1,
 * section 8/9) — independent of the AI feature. A custom field is always
 * created value-less (see CustomFieldForm.svelte), so filling it in is a
 * second, separate step through the normal "Angaben verwalten" save form.
 */
test('a custom currency field can be added, given a value, and displays localized', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Stromvertrag Ohne Vorlage');
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	const fieldsPanel = await openFieldsForEdit(page);
	await fieldsPanel.locator('details.fields-panel__add > summary').click();
	const addFieldForm = page.locator('form[action="?/addField"]');
	await addFieldForm.getByLabel('Bezeichnung', { exact: true }).fill('Grundpreis');
	await addFieldForm.getByLabel('Typ').selectOption('currency');
	await addFieldForm.getByRole('button', { name: 'Angabe hinzufügen' }).click();

	// Ensure the editable panel is open after the add-field action before
	// filling the new value.
	await openFieldsForEdit(page);
	const field = page.locator('#field-c_grundpreis');
	await expect(field).toBeVisible();
	await field.locator('input[type="text"]').fill('12.90');
	await page.getByRole('button', { name: 'Speichern' }).click();

	// The field is now filled, so "Angaben" reverts to its read-only view —
	// the value renders localized (comma decimal, euro symbol).
	await expect(page.locator('.data-row', { hasText: 'Grundpreis' })).toContainText('12,90 €');
});

/**
 * Regression: a removable custom field's "Entfernen" button used to sit
 * before the form's own "Speichern" button in DOM order, so a plain Enter
 * keypress in a field's value input triggered the browser's implicit form
 * submission via that first "Entfernen" button instead — silently deleting
 * the field instead of saving its value. The save button is now first in
 * DOM order (only reordered visually via CSS), so it is the form's default
 * submit again.
 */
test('pressing Enter in a custom field saves its value, not deletes the field', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Stromvertrag Enter-Key-Test');
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	const fieldsPanel = await openFieldsForEdit(page);
	await fieldsPanel.locator('details.fields-panel__add > summary').click();
	const addFieldForm = page.locator('form[action="?/addField"]');
	await addFieldForm.getByLabel('Bezeichnung', { exact: true }).fill('Vertragsnummer');
	await addFieldForm.getByRole('button', { name: 'Angabe hinzufügen' }).click();

	await openFieldsForEdit(page);
	const field = page.locator('#field-c_vertragsnummer');
	await field.locator('input[type="text"]').fill('N272914');
	await field.locator('input[type="text"]').press('Enter');

	await expect(page.locator('.data-row', { hasText: 'Vertragsnummer' })).toContainText('N272914');
});
