import { expect, test } from '@playwright/test';

/**
 * Structural regression guard for the core product invariant: "No orphan
 * tasks". Every action rendered on What's Next must live inside an
 * `.item-group` element headed by its item's title. This test creates a
 * mix of playbook-derived and manual actions across several items and
 * asserts the invariant page-wide, not just for one scenario's own item
 * (the other E2E specs each scope assertions to their own item group,
 * which would not catch a regression that renders one extra, ungrouped
 * action row elsewhere on the page).
 */
test('every action on What’s Next is grouped under an item — never a flat, orphaned list', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Orphan-Check TÜV');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2020-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Orphan-Check Generic');
	await page.getByRole('button', { name: 'Anlegen' }).click();

	// The manual-action form is folded into a closed <details> disclosure —
	// open it via its <summary> before interacting with the fields inside.
	await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
	const addActionForm = page.locator('form[action="?/addManualAction"]');
	await addActionForm.getByLabel('Bezeichnung der Aufgabe').fill('Orphan-Check manual action');
	await addActionForm.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();

	await page.goto('/');

	// Structural check: every .action-row's nearest .item-group ancestor
	// exists (Playwright's :scope XPath ancestor-or-self check), and the
	// count of action-rows found via that ancestor path equals the total
	// count of action-rows on the page — i.e. none exist outside a group.
	const allActionRows = page.locator('.action-row');
	const groupedActionRows = page.locator('.item-group .action-row');

	const totalCount = await allActionRows.count();
	const groupedCount = await groupedActionRows.count();

	expect(totalCount).toBeGreaterThan(0); // sanity: the test actually created visible actions
	expect(groupedCount).toBe(totalCount);

	// And both of this test's own items are present, each linked from its
	// own item-group context line (the group heading is a link, not an
	// <h*> — see ItemGroup.svelte).
	await expect(page.getByRole('link', { name: 'Orphan-Check TÜV' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Orphan-Check Generic' })).toBeVisible();
});
