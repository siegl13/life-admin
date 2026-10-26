import { expect, test, type Page } from '@playwright/test';

/**
 * Pickup date and pickup time as ordinary fields: each value shows its own
 * source excerpt (only when the extraction really carried one) and its own
 * confirmation. Uses the deterministic fake provider (LIFEADMIN_AI_FAKE=1):
 * its "Weiterer Termin" date suggestion carries an excerpt, its text
 * suggestion carries none. Scoped to its own items; enables AI for the run
 * and disables it again at the end.
 */
const MINIMAL_PDF = Buffer.from('%PDF-1.4\n%%EOF');
const ORIGIN = 'http://127.0.0.1:4173';
const SOURCE = 'Fiktive Belegstelle Termin';

async function setAi(page: Page, enabled: boolean) {
	await page.goto('/settings');
	if (enabled) {
		await page.getByLabel('Ich habe verstanden, dass ausgewählte Dokumente an OpenAI').check();
		await page.getByRole('button', { name: 'Einschalten' }).click();
		await expect(page.getByText('Eingeschaltet', { exact: true })).toBeVisible();
	} else {
		await page.getByRole('button', { name: 'Ausschalten' }).click();
		await expect(page.locator('#g-ai').getByText('Ausgeschaltet', { exact: true })).toBeVisible();
	}
}

function row(page: Page, label: string) {
	return page.locator('.fields-view .facts-group .data-row').filter({
		has: page.locator('.data-row__key', { hasText: new RegExp(`^\\s*${label}\\s*$`) })
	});
}

/** Creates an item whose pickup date (with excerpt) and time (without) come from the fake extraction. */
async function createItemWithPickup(page: Page, title: string): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();

	const upload = page.locator('form[action="?/addAttachment"]');
	await upload.locator('input[type="file"]').setInputFiles({
		name: 'transfer.pdf',
		mimeType: 'application/pdf',
		buffer: MINIMAL_PDF
	});
	await upload.getByRole('button', { name: 'Hinzufügen' }).click();
	await page.getByRole('link', { name: 'transfer.pdf' }).click();
	await page.getByRole('button', { name: 'Informationen erkennen' }).click();
	await expect(page).toHaveURL(/\/suggestions\//);

	const additional = page.locator('#additional-suggestions');
	// The suggested value and its excerpt are shown for review.
	await expect(additional.locator('q', { hasText: SOURCE }).first()).toBeVisible();

	// Unchanged accepted date: keeps its excerpt.
	const dateRow = additional.locator('.additional-suggestion', { hasText: 'Weiterer Termin' });
	await dateRow.getByRole('checkbox').check();
	await dateRow.locator('summary').click();
	await dateRow.getByLabel('Bezeichnung').fill('Abholdatum');

	// An edited text value no longer matches the excerpt: no source line.
	const timeRow = additional.locator('.additional-suggestion', {
		hasText: 'Zusätzliche Information'
	});
	await timeRow.getByRole('checkbox').check();
	await timeRow.locator('summary').click();
	await timeRow.getByLabel('Bezeichnung').fill('Abholzeit');
	await timeRow.getByLabel('Wert').fill('12:30');

	await additional.getByRole('button', { name: 'Ausgewählte hinzufügen' }).click();
	await expect(page).toHaveURL(itemUrl);
	return itemUrl;
}

/**
 * Same two fields without an extraction run. Extraction and Inbox analysis share one
 * daily run limit, so only the tests that need a source excerpt use the fake provider.
 */
async function createItemWithManualPickup(page: Page, title: string): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();
	const post = (action: string, form: Record<string, string>) =>
		page.request.post(`${itemUrl}?/${action}`, {
			form,
			headers: { accept: 'text/html', origin: ORIGIN }
		});
	await post('addField', { label: 'Abholdatum', type: 'date' });
	await post('addField', { label: 'Abholzeit', type: 'text' });
	await post('updateFields', { 'field:c_abholdatum': '2032-06-01', 'field:c_abholzeit': '12:30' });
	await page.goto(itemUrl);
	return itemUrl;
}

async function openEditing(page: Page) {
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
}

async function archive(page: Page, itemUrl: string) {
	const itemId = itemUrl.split('/').pop()!;
	await page.request.post(`/items/${itemId}?/archiveItem`, {
		form: {},
		headers: { accept: 'text/html', origin: ORIGIN }
	});
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
	const context = await browser.newContext({ storageState: '.data-e2e/playwright-auth.json' });
	await setAi(await context.newPage(), true);
	await context.close();
});

test.afterAll(async ({ browser }) => {
	const context = await browser.newContext({ storageState: '.data-e2e/playwright-auth.json' });
	await setAi(await context.newPage(), false);
	await context.close();
});

test('pickup date and time show their own source and independent confirmation', async ({
	page
}) => {
	const itemUrl = await createItemWithPickup(page, 'Transfer Bestätigung');
	const date = row(page, 'Abholdatum');
	const time = row(page, 'Abholzeit');

	// Accepting extracted values confirms nothing. Only the genuine excerpt shows.
	await expect(date).toContainText('1. Juni 2032');
	await expect(date).toContainText(`Quelle: ${SOURCE}`);
	await expect(date.locator('q')).toHaveText(SOURCE);
	await expect(date).toContainText('Nicht bestätigt');
	await expect(time).toContainText('12:30');
	await expect(time).not.toContainText('Quelle');
	await expect(time).toContainText('Nicht bestätigt');

	// English presentation: locale date, translated labels, time unchanged.
	try {
		await page.goto('/settings');
		await page.locator('#g-language form button[value="en"]').click();
		await page.goto(itemUrl);
		await expect(date).toContainText('1 June 2032');
		await expect(date).toContainText(`Source: ${SOURCE}`);
		await expect(date).toContainText('Not confirmed');
		await expect(time).toContainText('12:30');
		await expect(time.getByRole('button', { name: 'Confirm' })).toBeVisible();
	} finally {
		await page.goto('/settings');
		await page.locator('#g-language form button[value="browser"]').click();
		await page.goto(itemUrl);
	}

	// Confirming the time leaves the date unconfirmed, and survives a reload.
	await time.getByRole('button', { name: 'Bestätigen' }).click();
	await expect(time).toContainText('Bestätigt');
	await expect(date).toContainText('Nicht bestätigt');
	await page.reload();
	await expect(time).toContainText('Bestätigt');
	await expect(time).not.toContainText('Nicht bestätigt');
	await expect(date).toContainText('Nicht bestätigt');

	// Confirm the date too, then change only the date.
	await date.getByRole('button', { name: 'Bestätigen' }).click();
	await expect(date).toContainText('Bestätigt');
	await expect(date).not.toContainText('Nicht bestätigt');

	// Saving the unchanged form keeps both confirmations and the excerpt.
	await openEditing(page);
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page).toHaveURL(itemUrl);
	await expect(date).not.toContainText('Nicht bestätigt');
	await expect(date).toContainText(SOURCE);
	await expect(time).not.toContainText('Nicht bestätigt');

	// A different date resets only the date: confirmation and excerpt.
	await openEditing(page);
	await page.locator('#field-c_abholdatum input[type="date"]').fill('2032-06-02');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page).toHaveURL(itemUrl);
	await expect(date).toContainText('2. Juni 2032');
	await expect(date).toContainText('Nicht bestätigt');
	await expect(date).not.toContainText('Quelle');
	await expect(time).toContainText('Bestätigt');
	await expect(time).not.toContainText('Nicht bestätigt');

	// A different time resets only the time.
	await date.getByRole('button', { name: 'Bestätigen' }).click();
	await openEditing(page);
	await page.locator('#c_abholzeit').fill('13:00');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(time).toContainText('13:00');
	await expect(time).toContainText('Nicht bestätigt');
	await expect(date).not.toContainText('Nicht bestätigt');

	// Withdrawing a confirmation is a deliberate action too.
	await date.getByRole('button', { name: 'Bestätigung zurücknehmen' }).click();
	await expect(date).toContainText('Nicht bestätigt');

	await archive(page, itemUrl);
});

test('a missing value has nothing to confirm and cannot be confirmed by a crafted request', async ({
	page
}) => {
	const itemUrl = await createItemWithManualPickup(page, 'Transfer Leerwert');
	await openEditing(page);
	await page.locator('#c_abholzeit').fill('');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page).toHaveURL(itemUrl);
	await expect(row(page, 'Abholzeit')).toHaveCount(0);

	const itemId = itemUrl.split('/').pop()!;
	const response = await page.request.post(`/items/${itemId}?/setFieldConfirmation`, {
		form: { fieldKey: 'c_abholzeit', confirmed: 'yes' },
		headers: { accept: 'application/json', origin: ORIGIN }
	});
	expect(await response.json()).toMatchObject({ type: 'failure', status: 400 });
	await page.reload();
	await openEditing(page);
	await expect(page.locator('#c_abholzeit')).toHaveValue('');
	await archive(page, itemUrl);
});

test('date and time can be assigned to a user-selected group and stay read-only once archived', async ({
	page
}) => {
	const itemUrl = await createItemWithManualPickup(page, 'Transfer Gruppe');

	await openEditing(page);
	const manager = page.locator('details#field-groups');
	await manager.locator(':scope > summary').click();
	await manager.locator('details.group-add > summary').click();
	await manager.getByLabel('Neue Gruppe').fill('Rückreise');
	await manager.getByRole('button', { name: 'Gruppe anlegen' }).click();
	await expect(page).toHaveURL(/\?manage=groups#field-groups$/);
	await page.goto(itemUrl);
	await openEditing(page);

	for (const fieldKey of ['c_abholdatum', 'c_abholzeit']) {
		await page
			.locator(`#field-${fieldKey}`)
			.getByLabel('Gruppe')
			.selectOption({ label: 'Rückreise' });
	}
	await page
		.locator('form[action="?/updateFields"]')
		.getByRole('button', { name: 'Speichern' })
		.click();
	await expect(page).toHaveURL(itemUrl);

	await page.goto(itemUrl);
	await row(page, 'Abholzeit').getByRole('button', { name: 'Bestätigen' }).click();
	const group = page.locator('.fields-view .facts-group').filter({
		has: page.locator('.facts-group__label', { hasText: 'Rückreise' })
	});
	await expect(group.locator('.data-row')).toHaveCount(2);
	await expect(group).toContainText('Abholdatum');
	await expect(group).toContainText('Abholzeit');
	for (const width of [375, 390, 430, 1280]) {
		await page.setViewportSize({ width, height: 800 });
		await expect(group.locator('.facts-group__confirmation').first()).toBeVisible();
		await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
	}

	await archive(page, itemUrl);
	await page.goto(itemUrl);
	const archived = page.locator('.facts-view .data-row').filter({ hasText: 'Abholzeit' });
	await expect(archived).toContainText('Bestätigt');
	await expect(archived.getByRole('button')).toHaveCount(0);
	await expect(
		page.locator('.facts-view .data-row').filter({ hasText: 'Abholdatum' })
	).toContainText('Nicht bestätigt');
});

for (const timezoneId of ['Pacific/Auckland', 'America/Los_Angeles']) {
	test.describe(`viewer timezone ${timezoneId}`, () => {
		test.use({ timezoneId });

		test('pickup time and date are shown as stored', async ({ page }) => {
			const itemUrl = await createItemWithManualPickup(page, `Transfer ${timezoneId}`);
			await expect(row(page, 'Abholzeit')).toContainText('12:30');
			await expect(row(page, 'Abholdatum')).toContainText('1. Juni 2032');
			expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
				timezoneId
			);
			await archive(page, itemUrl);
		});
	});
}

test('confirmation works with the keyboard and without JavaScript', async ({ browser }) => {
	const setup = await browser.newContext({ storageState: '.data-e2e/playwright-auth.json' });
	const itemUrl = await createItemWithManualPickup(await setup.newPage(), 'Transfer NoJS');
	await setup.close();

	const context = await browser.newContext({
		storageState: '.data-e2e/playwright-auth.json',
		javaScriptEnabled: false
	});
	const page = await context.newPage();
	try {
		await page.goto(itemUrl);
		const time = row(page, 'Abholzeit');
		const button = time.getByRole('button', { name: 'Bestätigen' });
		await button.focus();
		await expect(button).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(new RegExp(`${itemUrl}#field-fact-c_abholzeit$`));
		await expect(row(page, 'Abholzeit')).toContainText('Bestätigt');
		await expect(row(page, 'Abholdatum')).toContainText('Nicht bestätigt');
		await archive(page, itemUrl);
	} finally {
		await context.close();
	}
});
