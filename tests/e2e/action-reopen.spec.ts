import { expect, test } from '@playwright/test';

/**
 * Reopening: a DONE or SKIPPED action can go back to OPEN. No cascade —
 * a dependent action that already became available loses that
 * availability again the moment its dependency is reopened, since
 * availability is always re-derived live (see dependencies.ts), never
 * cached.
 */
test('completing, then reopening an action makes it available again and un-blocks nothing downstream', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Reopen Flow Test');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2020-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	function step(title: string) {
		return page
			.locator('.timeline__step')
			.filter({ has: page.locator('.timeline__title', { hasText: title }) });
	}

	await step('HU-Termin planen').getByRole('button', { name: 'Erledigen' }).click();

	// Done: shows the completion hint and a reopen control, dependent
	// step is now available.
	await expect(step('HU-Termin planen')).toContainText('Erledigt');
	await expect(step('Fahrzeug / Unterlagen vorbereiten')).toContainText('Jetzt möglich');

	await step('HU-Termin planen').getByRole('button', { name: 'Wieder öffnen' }).click();

	// Reopened: back to "now", and the dependent step is blocked again
	// since its dependency is no longer DONE.
	await expect(step('HU-Termin planen')).toContainText('Jetzt möglich');
	await expect(step('Fahrzeug / Unterlagen vorbereiten')).not.toContainText('Jetzt möglich');

	// The reopen shows up in the history log (always visible, not a
	// disclosure — see ItemHistory.svelte).
	await expect(page.getByText('Aufgabe wieder geöffnet')).toBeVisible();
});

test('a crafted reopenAction POST against an archived item is refused', async ({ page }) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Reopen Archived Guard Test');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();
	const itemId = itemUrl.split('/').pop()!;

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2020-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	const actionId = await page
		.locator('.timeline__step', { hasText: 'HU-Termin planen' })
		.locator('form[action="?/completeAction"] input[name="actionId"]')
		.getAttribute('value');
	expect(actionId).toBeTruthy();

	await page
		.locator('.timeline__step', { hasText: 'HU-Termin planen' })
		.getByRole('button', { name: 'Erledigen' })
		.click();

	// No reopen control anywhere on an archived (read-only) item.
	await page.locator('summary', { hasText: 'Archivieren' }).click();
	await page
		.locator('form[action="?/archiveItem"]')
		.getByRole('button', { name: 'Archivieren' })
		.click();
	await expect(page.locator('form[action="?/reopenAction"]')).toHaveCount(0);

	const response = await page.request.post(`${itemUrl}?/reopenAction`, {
		form: { actionId: actionId!, itemId },
		headers: { accept: 'text/html', origin: 'http://127.0.0.1:4173' }
	});
	expect(response.status()).toBe(400);
});
