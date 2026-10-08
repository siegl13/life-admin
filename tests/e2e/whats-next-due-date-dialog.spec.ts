import { expect, test, type Page } from '@playwright/test';

/**
 * Part B: changing a DERIVED action's due date from the What's Next row
 * itself, without leaving the page. The link stays a normal anchor to the
 * Item detail action anchor (see whats-next-redesign.spec.ts for the
 * no-JavaScript href assertion); with JavaScript, its click is intercepted
 * to open a closed-by-default on-page `<dialog>` instead, sharing the
 * guarded write with Item detail's own editor (actionTransition.ts).
 */

const ORIGIN = 'http://127.0.0.1:4173';

async function createTuvItemWithDerivedAction(page: Page, title: string): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemId = page.url().split('/').pop()!;
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2099-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();
	return itemId;
}

async function createGenericItem(page: Page, title: string): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	return page.url().split('/').pop()!;
}

async function addManualAction(page: Page, label: string, dueDate?: string) {
	const addActionForm = page.locator('form[action="?/addManualAction"]');
	await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
	await addActionForm.getByLabel('Bezeichnung der Aufgabe').fill(label);
	if (dueDate) await addActionForm.getByLabel('Fällig am (optional)').fill(dueDate);
	await addActionForm.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
}

async function archiveItem(page: Page, itemId: string) {
	await page.request.post(`/items/${itemId}?/archiveItem`, {
		form: {},
		headers: { accept: 'text/html', origin: ORIGIN }
	});
}

test('opens its own on-page dialog with JavaScript, sets an override and the row shows the new date', async ({
	page
}) => {
	const title = `Dialog set ${Date.now()}`;
	const itemId = await createTuvItemWithDerivedAction(page, title);
	try {
		await page.goto('/');
		const group = page.locator('.item-group', { hasText: title });
		const row = group.locator('.action-row', { hasText: 'HU-Termin planen' });
		await row.locator('summary').click();
		const link = row.getByRole('link', { name: 'Datum ändern' });

		await link.click();
		// Clicking with JavaScript enabled must open the dialog in place,
		// never navigate away.
		await expect(page).toHaveURL('/');
		const dialog = group.getByRole('dialog', { name: 'Datum ändern' });
		await expect(dialog).toBeVisible();
		await expect(row.locator('details.action-menu')).not.toHaveAttribute('open', '');
		await expect(dialog.locator('.meta')).toHaveCount(1);
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(row.locator('summary')).toBeFocused();
		const menu = row.locator('details.action-menu');
		if (!(await menu.evaluate((element) => element.hasAttribute('open')))) {
			await row.locator('summary').click();
		}
		await link.click();
		await expect(dialog).toBeVisible();

		await dialog.getByLabel('Termin').fill('2099-01-15');
		await dialog.getByRole('button', { name: 'Termin speichern' }).click();

		await expect(page).toHaveURL('/');
		await expect(row).toContainText('15. Januar 2099');
	} finally {
		await archiveItem(page, itemId);
	}
});

test('reset is offered only once an override exists, and clears it back to the suggestion', async ({
	page
}) => {
	const title = `Dialog reset ${Date.now()}`;
	const itemId = await createTuvItemWithDerivedAction(page, title);
	try {
		await page.goto('/');
		const group = page.locator('.item-group', { hasText: title });
		const row = group.locator('.action-row', { hasText: 'HU-Termin planen' });
		await row.locator('summary').click();
		await expect(row.getByRole('button', { name: 'Auf Vorschlag zurücksetzen' })).toHaveCount(0);
		await row.getByRole('link', { name: 'Datum ändern' }).click();
		const dialog = group.getByRole('dialog', { name: 'Datum ändern' });
		const suggestedDate = await dialog.getByLabel('Termin').inputValue();
		await dialog.getByRole('button', { name: 'Termin speichern' }).click();

		await expect(row).toContainText('1. Dezember 2098');
		await row.locator('summary').click();
		await expect(row.getByRole('button', { name: 'Auf Vorschlag zurücksetzen' })).toBeVisible();
		await row.getByRole('link', { name: 'Datum ändern' }).click();
		await expect(dialog.locator('.meta')).toHaveCount(1);
		await expect(dialog.getByLabel('Termin')).toHaveValue(suggestedDate);
		await dialog.getByRole('button', { name: 'Abbrechen' }).click();

		await row.locator('summary').click();
		await row.getByRole('link', { name: 'Datum ändern' }).click();
		await dialog.getByLabel('Termin').fill('2099-02-01');
		await dialog.getByRole('button', { name: 'Termin speichern' }).click();

		await expect(row).toContainText('1. Februar 2099');
		await row.locator('summary').click();
		await row.getByRole('link', { name: 'Datum ändern' }).click();
		await expect(group.getByRole('dialog', { name: 'Datum ändern' }).locator('.meta')).toHaveCount(
			2
		);
		await group
			.getByRole('dialog', { name: 'Datum ändern' })
			.getByRole('button', { name: 'Abbrechen' })
			.click();
		await row.locator('summary').click();
		await row.getByRole('button', { name: 'Auf Vorschlag zurücksetzen' }).click();

		await expect(row).not.toContainText('1. Februar 2099');
		await row.locator('summary').click();
		await expect(row.getByRole('button', { name: 'Auf Vorschlag zurücksetzen' })).toHaveCount(0);
	} finally {
		await archiveItem(page, itemId);
	}
});

test('an invalid submitted date is rejected, keeps its value and reopens the same row dialog', async ({
	page
}) => {
	const title = `Dialog invalid ${Date.now()}`;
	const itemId = await createTuvItemWithDerivedAction(page, title);
	try {
		await page.goto('/');
		const group = page.locator('.item-group', { hasText: title });
		const row = group.locator('.action-row', { hasText: 'HU-Termin planen' });
		await row.locator('summary').click();
		await row.getByRole('link', { name: 'Datum ändern' }).click();

		const dialog = group.getByRole('dialog', { name: 'Datum ändern' });
		const dateInput = dialog.getByLabel('Termin');
		// Bypasses the native date picker's own format enforcement so the
		// server's own ISO-date validation (not the browser's) is what gets
		// exercised — mirrors how a crafted/non-browser submission would
		// arrive at the same route.
		await dateInput.evaluate((el: HTMLInputElement) => {
			el.type = 'text';
			el.value = 'not-a-date';
		});
		await dialog.getByRole('button', { name: 'Termin speichern' }).click();

		// A rejected submission renders in place rather than redirecting, so
		// the address bar keeps the POST target's own query suffix.
		await expect(page).toHaveURL(/\?\/setActionDueOverride$/);
		const reopened = group.getByRole('dialog', { name: 'Datum ändern' });
		await expect(reopened).toBeVisible();
		await expect(reopened.getByRole('alert')).toHaveText('Bitte ein gültiges Datum eingeben.');
		// Reopening a rejected submission swaps the native date input for a
		// plain text one (see ActionRow.svelte), so the exact rejected text
		// survives and stays editable, instead of being silently sanitized to
		// "" by the browser's own date-input parsing.
		await expect(reopened.locator('input[name="dueDate"]')).toHaveValue('not-a-date');

		// A corrected, valid submission from that same reopened field succeeds.
		await reopened.locator('input[name="dueDate"]').fill('2099-03-01');
		await reopened.getByRole('button', { name: 'Termin speichern' }).click();
		await expect(row).toContainText('1. März 2099');
	} finally {
		await archiveItem(page, itemId);
	}
});

test('a manual action never offers the change-due-date menu option', async ({ page }) => {
	const title = `No menu for manual ${Date.now()}`;
	const itemId = await createGenericItem(page, title);
	try {
		await addManualAction(page, 'Manual task', '2099-01-01');
		await page.goto('/');
		const group = page.locator('.item-group', { hasText: title });
		const row = group.locator('.action-row', { hasText: 'Manual task' });
		await row.locator('summary').click();
		await expect(row.getByRole('link', { name: 'Datum ändern' })).toHaveCount(0);
		await expect(row.getByRole('button', { name: 'Auf Vorschlag zurücksetzen' })).toHaveCount(0);
	} finally {
		await archiveItem(page, itemId);
	}
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('the change-due-date link navigates straight to the Item detail action anchor, and no dialog renders open', async ({
		page
	}) => {
		const title = `No-JS link ${Date.now()}`;
		const itemId = await createTuvItemWithDerivedAction(page, title);
		try {
			await page.goto('/');
			const group = page.locator('.item-group', { hasText: title });
			const row = group.locator('.action-row', { hasText: 'HU-Termin planen' });
			await row.locator('summary').click();
			// What's Next must never render a per-row dialog statically open —
			// unlike Item detail's own no-JavaScript fallback.
			await expect(group.locator('dialog.action-dialog[open]')).toHaveCount(0);

			await row.getByRole('link', { name: 'Datum ändern' }).click();
			await expect(page).toHaveURL(new RegExp(`/items/${itemId}#action-`));
		} finally {
			await archiveItem(page, itemId);
		}
	});
});

test('375px: the open due-date dialog does not cause horizontal overflow', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 700 });
	const title = `Narrow dialog ${Date.now()}`;
	const itemId = await createTuvItemWithDerivedAction(page, title);
	try {
		await page.goto('/');
		const group = page.locator('.item-group', { hasText: title });
		const row = group.locator('.action-row', { hasText: 'HU-Termin planen' });
		await row.locator('summary').click();
		await row.getByRole('link', { name: 'Datum ändern' }).click();
		await expect(group.getByRole('dialog', { name: 'Datum ändern' })).toBeVisible();

		const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
		expect(scrollWidth).toBeLessThanOrEqual(375);
	} finally {
		await archiveItem(page, itemId);
	}
});

test('a due-date form submitted against an action whose cycle completed in another tab renders an error, never a 500', async ({
	page
}) => {
	const title = `Stale cycle ${Date.now()}`;
	const itemId = await createTuvItemWithDerivedAction(page, title);
	const other = await page.context().newPage();
	try {
		await page.goto('/');
		const group = page.locator('.item-group', { hasText: title });
		const row = group.locator('.action-row', { hasText: 'HU-Termin planen' });
		await row.locator('summary').click();
		await row.getByRole('link', { name: 'Datum ändern' }).click();
		const dialog = group.getByRole('dialog', { name: 'Datum ändern' });
		await expect(dialog).toBeVisible();

		// Complete this exact Action in another tab but keep its cycle active.
		// The root route must recheck its state, not rely only on the repository's
		// item/cycle/DERIVED guard.
		await other.goto(`/items/${itemId}`);
		await other
			.locator('.next-up__actions')
			.getByRole('button', { name: 'Erledigen', exact: true })
			.click();

		// Tab 1 still has the stale dialog open on the now-completed cycle's
		// action; submitting it must render a clear error, never a 500.
		await dialog.getByLabel('Termin').fill('2026-06-01');
		const [response] = await Promise.all([
			page.waitForResponse(
				(res) => res.request().method() === 'POST' && res.url().includes('/?/setActionDueOverride')
			),
			dialog.getByRole('button', { name: 'Termin speichern' }).click()
		]);
		expect(response.status()).toBe(400);
		await expect(page.getByRole('alert')).toContainText(
			'Diese Aufgabe kann gerade nicht geändert werden.'
		);
	} finally {
		await other.close();
		await archiveItem(page, itemId);
	}
});
