import { expect, test } from '@playwright/test';

/**
 * A generic item (no playbook) stays useful thanks to custom fields and
 * manual actions — but a manual action always belongs to its item (no
 * top-level "add task" entry point exists anywhere in the UI).
 */
test('generic item: title only, add a custom date field, add a manual action, see it in What’s Next under its item', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Mallorca-Reise');
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	// "Angaben" itself defaults to the closed, read-only view — open it
	// before reaching the custom-field disclosure nested inside.
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();

	// Both the custom-field and manual-action forms are folded into closed
	// <details> disclosures. Regression guard: a closed disclosure must
	// actually hide its form (a past CSS specificity bug left it visible
	// and interactive even while marked "closed") — open each via its
	// <summary> first.
	const addFieldForm = page.locator('form[action="?/addField"]');
	await expect(addFieldForm).toBeHidden();
	await page.locator('summary', { hasText: 'Angabe hinzufügen' }).click();
	await expect(addFieldForm).toBeVisible();
	await addFieldForm.getByLabel('Bezeichnung', { exact: true }).fill('Departure date');
	await addFieldForm.getByLabel('Typ').selectOption('date');
	await addFieldForm.getByRole('button', { name: 'Angabe hinzufügen' }).click();
	// Scoped to the field's own id: its label also appears in the separate
	// read-only "Angaben" view, which always stays in the DOM alongside the
	// edit form (only one of the two is shown at a time, via CSS). The
	// redirect lands on this anchor, but a closed <details> is not
	// auto-opened by fragment navigation — reopen it by hand.
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await expect(page.locator('#field-c_departure_date')).toBeVisible();

	const addActionForm = page.locator('form[action="?/addManualAction"]');
	await expect(addActionForm).toBeHidden();
	await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
	await expect(addActionForm).toBeVisible();
	await addActionForm.getByLabel('Bezeichnung der Aufgabe').fill('Remaining payment');
	await addActionForm.getByLabel('Fällig am (optional)').fill('2020-01-01');
	await addActionForm.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();

	await page.goto('/');
	const group = page.locator('.item-group', { hasText: 'Mallorca-Reise' });
	await expect(group).toBeVisible();
	await expect(group.getByText('Remaining payment')).toBeVisible();
});
