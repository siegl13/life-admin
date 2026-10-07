import { expect, test } from '@playwright/test';

/**
 * Progressive data entry (Slice 2 core acceptance criterion): only the
 * title is mandatory. Slice 2 delivers item creation, reopening, custom
 * fields and progressive field entry — this spec covers that. The
 * remaining half of the full flow ("derived action becomes available
 * once the date is filled in") needs the What's Next screen and is
 * extended here once Slice 3 lands.
 */

async function openFieldsForEdit(page: import('@playwright/test').Page) {
	const panel = page.locator('details.fields-panel').filter({ has: page.locator('#fields-label') });
	if (!(await panel.evaluate((node) => node instanceof HTMLDetailsElement && node.open))) {
		await panel.locator(':scope > summary').click();
	}
	await expect(panel).toHaveAttribute('open', '');
}

test('a generic item (no playbook) can be created with only a title', async ({ page }) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Mallorca Trip');
	await page.getByRole('button', { name: 'Anlegen' }).click();

	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	await expect(page.getByRole('heading', { name: 'Mallorca Trip' })).toBeVisible();
});

test('an item can be created from a playbook, saved with the date field empty, then reopened and filled in', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Zweitwagen');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();

	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();

	// The recommended date field is visibly optional, not required, and
	// the item saves without it.
	await openFieldsForEdit(page);
	const dateInput = page.locator('input[type="date"]').first();
	await expect(dateInput).not.toHaveAttribute('required');

	// Critical rule: an unresolved DERIVED action must not appear on
	// What's Next while its date is missing — the item must not show up
	// there at all yet.
	await page.goto('/');
	await expect(page.locator('.item-group', { hasText: 'Zweitwagen' })).toHaveCount(0);

	// Reopen the item (simulate the user coming back later).
	await page.goto(itemUrl);
	await expect(page.getByRole('heading', { name: 'Zweitwagen' })).toBeVisible();

	// Now fill in the date and save.
	await openFieldsForEdit(page);
	await page.locator('input[type="date"]').first().fill('2026-12-25');
	await page.getByRole('button', { name: 'Speichern' }).click();

	// Reload and confirm the value persisted. Scoped to the field's own id
	// (not `.first()`): once the date resolves, the action becomes "now"
	// and gains its own due-date-override date input higher up the page.
	await page.goto(itemUrl);
	await openFieldsForEdit(page);
	await expect(page.locator('#next_inspection')).toHaveValue('2026-12-25');

	// Now that the date is resolved, the derived action must appear on
	// What's Next, grouped under this item.
	await page.goto('/');
	const group = page.locator('.item-group', { hasText: 'Zweitwagen' });
	await expect(group).toBeVisible();
	await expect(group.getByText('HU-Termin planen')).toBeVisible();
});

test('a custom field can be added to a generic item and its value persists', async ({ page }) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Generic Item With Custom Field');
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	// The custom-field form is nested inside the fields disclosure.
	await openFieldsForEdit(page);
	await page.locator('summary', { hasText: 'Angabe hinzufügen' }).click();
	const addFieldForm = page.locator('form[action="?/addField"]');
	await addFieldForm.getByLabel('Bezeichnung', { exact: true }).fill('Policy number');
	await addFieldForm.getByRole('button', { name: 'Angabe hinzufügen' }).click();

	// The action can preserve the open state; do not toggle it closed.
	// Scoped to the field's own id: its label also appears in the separate
	// read-only "Angaben" view, which always stays in the DOM alongside the
	// edit form (only one of the two is shown at a time, via CSS).
	await openFieldsForEdit(page);
	await expect(page.locator('#field-c_policy_number')).toBeVisible();

	// Discoverability regression guard: after creation, the user must land
	// back on the field they just created (URL carries its anchor) and the
	// "Angabe hinzufügen" disclosure must be closed again — the field
	// should never leave the user wondering where it went, or make them
	// scroll past a still-open creation form to find it.
	await expect(page).toHaveURL(/#field-c_[a-z0-9_-]+$/);
	await expect(page.locator('form[action="?/addField"]')).toBeHidden();
});
