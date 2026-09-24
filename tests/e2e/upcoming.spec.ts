import { expect, test } from '@playwright/test';

test('shows future manual actions in Upcoming and keeps the page usable on mobile', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Upcoming mobile item');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('#next_inspection').fill('2099-01-15');
	await page.getByRole('button', { name: 'Speichern' }).click();

	await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
	await page
		.getByLabel('Bezeichnung der Aufgabe')
		.fill('A very long manual action label that must remain readable on mobile');
	await page.getByLabel(/Fällig am/).fill('2099-01-15');
	await page.getByRole('button', { name: 'Aufgabe hinzufügen', exact: true }).click();

	await page.goto('/upcoming');
	await expect(page.getByRole('heading', { name: 'Demnächst' })).toBeVisible();
	const ranges = page.locator('.upcoming-range');
	for (let index = 0; index < (await ranges.count()); index += 1) {
		const range = ranges.nth(index);
		await expect(range.locator('.upcoming-range__count')).toHaveText(
			String(await range.locator('.upcoming-row').count())
		);
	}
	const laterRange = page.locator('.upcoming-range').filter({ hasText: 'Später' });
	const createdItemRows = laterRange
		.locator('.upcoming-row')
		.filter({ hasText: 'Upcoming mobile item' });
	await expect(createdItemRows).toHaveCount(4);
	const availableAction = createdItemRows.filter({ hasText: 'HU-Termin planen' });
	await expect(availableAction.getByText('Jetzt möglich', { exact: true })).toBeVisible();
	const blockedActions = page
		.locator('.upcoming-row')
		.filter({ hasText: 'Upcoming mobile item' })
		.filter({ hasText: 'Wartet auf vorherigen Schritt' });
	await expect(blockedActions).toHaveCount(2);
	await expect(
		page.getByText('A very long manual action label that must remain readable on mobile')
	).toBeVisible();
	await expect(page.getByRole('link', { name: 'Demnächst' }).first()).toHaveAttribute(
		'aria-current',
		'page'
	);

	await page.setViewportSize({ width: 375, height: 667 });
	await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375);
});

test('protects Upcoming for unauthenticated requests', async ({ browser }) => {
	const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
	const response = await context.request.get('/upcoming', { maxRedirects: 0 });
	expect(response.status()).toBe(303);
	expect(response.headers().location).toMatch(/^\/login\?redirectTo=/);
	await context.close();
});
