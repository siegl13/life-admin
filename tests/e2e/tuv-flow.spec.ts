import { expect, test } from '@playwright/test';

/**
 * Slice 3 major gate: the simple real-playbook flow. Create a TÜV item,
 * enter the inspection date, see the derived action appear on the
 * What's Next screen grouped under its item, then complete it and
 * confirm it disappears from the current working set.
 *
 * All assertions are scoped to this test's own item group: the E2E
 * database persists across every spec in the run, and another spec's
 * TÜV item could otherwise show the same action label ("Prüftermin
 * buchen") in its own group, making an unscoped page-wide assertion
 * fragile.
 */
test('TÜV item: enter due date, see the action in What’s Next with item context, complete it', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Erstwagen');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	// Enter a past date so the action is immediately overdue (never
	// requires waiting on the real clock in a test).
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2020-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	await page.goto('/');
	const group = page.locator('.item-group', { hasText: 'Erstwagen' });

	// Item context is always visible: the action never renders without
	// its item context line (a link to the item) above it — see
	// ItemGroup.svelte.
	await expect(group.getByRole('link', { name: 'Erstwagen' })).toBeVisible();
	await expect(group.getByText('HU-Termin planen')).toBeVisible();

	await group.getByRole('button', { name: 'Erledigen' }).click();

	// Completed: the first action disappears, and the second
	// (dependent) action becomes available under the same item.
	await expect(group.getByText('HU-Termin planen')).toHaveCount(0);
	await expect(group.getByText('Fahrzeug / Unterlagen vorbereiten')).toBeVisible();
});
