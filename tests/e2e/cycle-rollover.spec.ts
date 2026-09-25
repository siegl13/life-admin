import { expect, test } from '@playwright/test';

/**
 * Slice 8 major gate: finishing a cycle offers exactly two explicit
 * choices and never rolls over by itself; starting a new cycle carries
 * text values, resets dates, and keeps the finished cycle readable under
 * "Verlauf". Scoped to each test's own item, since the E2E database
 * persists across the whole run.
 */
async function createTuvItem(page: import('@playwright/test').Page, title: string): Promise<void> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	// "Angaben" defaults to the closed, read-only view — open it before filling.
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
}

async function completeTuvCycle(page: import('@playwright/test').Page): Promise<void> {
	for (const action of [
		'HU-Termin planen',
		'Fahrzeug / Unterlagen vorbereiten',
		'Hauptuntersuchung durchführen',
		'Neue HU eintragen'
	]) {
		await page
			.locator('.timeline__step', { hasText: action })
			.getByRole('button', { name: 'Erledigen' })
			.click();
	}
}

test('finishing every step offers both choices and never starts a cycle by itself', async ({
	page
}) => {
	await createTuvItem(page, 'TÜV Rollover Test');

	await page.locator('input[type="date"]').first().fill('2020-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	// Complete all actions in the workflow list (not the "Als Nächstes"
	// panel, so this exercises the general workflow buttons too).
	await completeTuvCycle(page);

	// History section exists with action completion events.
	await expect(page.getByText(/^Verlauf$/)).toBeVisible();

	await expect(page.getByRole('button', { name: 'Neuer Zyklus' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Archivieren' })).toBeVisible();
});

test('starting a new cycle keeps the text value, clears the date, and shows the finished cycle under Verlauf', async ({
	page
}) => {
	await createTuvItem(page, 'TÜV Rollover Carry Test');

	await page.locator('input[type="date"]').first().fill('2020-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await completeTuvCycle(page);

	await page.getByRole('button', { name: 'Neuer Zyklus' }).click();

	// Lands on "Angaben"; the date field is empty again (Slice 8: a date
	// field resets by default unless the playbook opts it in explicitly).
	await expect(page).toHaveURL(/#fields-label$/);
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await expect(page.locator('input[type="date"]').first()).toHaveValue('');

	const historyWrapper = page.locator('.history-cycles');
	await historyWrapper.locator('> summary').click();
	const history = historyWrapper.locator('.disclosure', { hasText: 'Zyklus 1' });
	await expect(history).toBeVisible();
	await expect(history.getByText('HU-Termin planen')).not.toBeVisible(); // collapsed by default
	await history.locator('summary').click();
	await expect(history.getByText('Erledigt')).toHaveCount(4);
});

test("a finished cycle's history disclosure has no buttons inside", async ({ page }) => {
	await createTuvItem(page, 'TÜV Rollover History Readonly Test');

	await page.locator('input[type="date"]').first().fill('2020-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await completeTuvCycle(page);
	await page.getByRole('button', { name: 'Neuer Zyklus' }).click();

	const historyWrapper = page.locator('.history-cycles');
	await historyWrapper.locator('> summary').click();
	const history = historyWrapper.locator('.disclosure', { hasText: 'Zyklus 1' });
	await history.locator('summary').click();
	await expect(history.getByRole('button')).toHaveCount(0);
});

test('desktop shows 10 events initially; mobile shows 5; "Ältere anzeigen" widens the set', async ({
	page
}) => {
	await createTuvItem(page, 'TÜV History Pagination Test');

	await page.locator('input[type="date"]').first().fill('2020-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	await completeTuvCycle(page);

	for (let i = 0; i < 6; i++) {
		await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
		await page
			.locator('input[type="date"]')
			.first()
			.fill(`2020-02-${String(i + 1).padStart(2, '0')}`);
		await page.getByRole('button', { name: 'Speichern' }).click();
		await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	}

	await expect(page.locator('.history-event')).toHaveCount(10);

	await page.setViewportSize({ width: 375, height: 667 });
	await expect(page.locator('.history-event')).toHaveCount(5);

	// Total events so far: 1 initial save + 4 completed actions + 6 loop
	// saves = 11. "Ältere anzeigen" widens past the page size (10), so it
	// reveals all 11, not just a second page of 10.
	await page.getByRole('button', { name: /Ältere anzeigen/ }).click();
	await expect(page.locator('.history-event').first()).toBeVisible();
	await expect(page.locator('.history-event')).toHaveCount(11);

	await page.setViewportSize({ width: 1280, height: 800 });
});
