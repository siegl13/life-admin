import { expect, test } from '@playwright/test';

const MINIMAL_PDF = Buffer.from('%PDF-1.4\n%%EOF');

test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });

function inboxRow(page: import('@playwright/test').Page, filename: string) {
	return page
		.getByRole('listitem')
		.filter({ has: page.getByRole('heading', { name: filename, level: 3 }) });
}

function inboxDetail(page: import('@playwright/test').Page) {
	return page.locator('.inbox-detail');
}

async function openRow(page: import('@playwright/test').Page, filename: string): Promise<void> {
	const row = inboxRow(page, filename);
	await activate(row.locator('a[href*="/inbox?doc="]'));
	await expect(inboxDetail(page).getByRole('heading', { name: filename, level: 2 })).toBeVisible();
}

async function uploadInboxDocument(
	page: import('@playwright/test').Page,
	filename: string
): Promise<void> {
	await page.goto('/inbox');
	await page
		.locator('form[action="?/upload"] input[type="file"]')
		.setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: MINIMAL_PDF });
	await page
		.locator('form[action="?/upload"]')
		.getByRole('button', { name: 'In Eingang ablegen' })
		.click();
	await expect(inboxRow(page, filename)).toBeVisible();
	await openRow(page, filename);
}

async function activate(control: import('@playwright/test').Locator): Promise<void> {
	await control.focus();
	await control.press('Enter');
}

async function checkVisible(control: import('@playwright/test').Locator): Promise<void> {
	await control.focus();
	if (!(await control.isChecked())) await control.press('Space');
	await expect(control).toBeChecked();
}

async function deleteIfPending(
	page: import('@playwright/test').Page,
	filename: string
): Promise<void> {
	await page.goto('/inbox');
	const row = inboxRow(page, filename);
	if ((await row.count()) === 0) return;
	await openRow(page, filename);
	await activate(inboxDetail(page).getByRole('button', { name: 'Dokument löschen' }));
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page): Promise<void> {
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
		.toBe(true);
}

test('shows the approved empty Inbox upload state at 390px', async ({ page }) => {
	await page.goto('/inbox');
	await expect(page.getByRole('heading', { name: 'Eingang', level: 1 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Eingang leer', level: 2 })).toBeVisible();
	await expect(page.getByText('PDF, JPEG, PNG oder WebP · höchstens 10 MB')).toBeVisible();
	await expect(page.getByText('Datei auswählen')).toBeVisible();
	await expectNoHorizontalOverflow(page);
});

test.describe('Inbox routing without JavaScript at 390px', () => {
	test('uploads and routes a document to a new generic item after explicit confirmation', async ({
		page
	}) => {
		await uploadInboxDocument(page, 'inbox-generic.pdf');
		const routeForm = inboxDetail(page).locator('form[action="?/route"]');
		await expect(routeForm).toHaveCount(1);
		await expect(routeForm.locator('input[name="confirmed"]')).toHaveCount(1);
		await expect(routeForm.locator('button.route-primary')).toHaveCount(1);
		await expectNoHorizontalOverflow(page);
		await checkVisible(routeForm.getByLabel('Als neues Element anlegen'));
		await routeForm.getByLabel('Titel').fill('Inbox generic item');
		await checkVisible(routeForm.getByLabel('Ich habe die Zuordnung geprüft.'));
		await activate(routeForm.getByRole('button', { name: 'Element anlegen und ablegen' }));
		await expect(page).toHaveURL(/\/items\/[0-9a-f-]+#attachment-/);
		await expect(
			page.locator('.fields-view .document-row', { hasText: 'inbox-generic.pdf' })
		).toBeVisible();
	});
});

test('rejects a disguised unsupported Inbox upload', async ({ page }) => {
	await page.goto('/inbox');
	await page.locator('form[action="?/upload"] input[type="file"]').setInputFiles({
		name: 'not-an-image.png',
		mimeType: 'image/png',
		buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
	});
	await page
		.locator('form[action="?/upload"]')
		.getByRole('button', { name: 'In Eingang ablegen' })
		.click();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(inboxRow(page, 'not-an-image.png')).toHaveCount(0);
});

test('keeps explicit confirmation enforced by the server', async ({ page }) => {
	try {
		await uploadInboxDocument(page, 'inbox-confirmation.pdf');
		const documentId = await inboxDetail(page).locator('input[name="documentId"]').inputValue();
		const response = await page.request.post('/inbox?/route', {
			headers: { Origin: new URL(page.url()).origin, 'Accept-Language': 'de-DE' },
			form: {
				documentId,
				destination: 'new',
				title: 'Unconfirmed Inbox item'
			}
		});
		expect(await response.text()).toContain('Bitte bestätige die Zuordnung.');
		await page.reload();
		await expect(inboxRow(page, 'inbox-confirmation.pdf')).toBeVisible();
	} finally {
		await deleteIfPending(page, 'inbox-confirmation.pdf');
	}
});

test('routes an Inbox document to an existing item and deletes an unneeded pending document', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Inbox existing item');
	await page.getByRole('button', { name: 'Anlegen' }).click();
	const itemUrl = page.url();

	await uploadInboxDocument(page, 'inbox-existing.pdf');
	const routeForm = inboxDetail(page).locator('form[action="?/route"]');
	await checkVisible(routeForm.getByLabel('Als neues Element anlegen'));
	await routeForm.getByLabel('Titel').fill('');
	await checkVisible(routeForm.getByRole('radio', { name: 'Zu einem bestehenden Element' }));
	await routeForm.locator('select[name="itemId"]').selectOption({ label: 'Inbox existing item' });
	await checkVisible(routeForm.getByLabel('Ich habe die Zuordnung geprüft.'));
	await activate(routeForm.getByRole('button', { name: 'Zuordnen und ablegen' }));
	await expect(page).toHaveURL(
		new RegExp(`${itemUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}#attachment-`)
	);

	await uploadInboxDocument(page, 'inbox-delete.pdf');
	await activate(inboxDetail(page).getByRole('button', { name: 'Dokument löschen' }));
	await expect(inboxRow(page, 'inbox-delete.pdf')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Eingang leer', level: 2 })).toBeVisible();
});

test('routes an Inbox document through an installed playbook', async ({ page }) => {
	await uploadInboxDocument(page, 'inbox-playbook.pdf');
	const routeForm = inboxDetail(page).locator('form[action="?/route"]');
	const playbookSelect = routeForm.locator('select[name="playbookId"]');
	await checkVisible(routeForm.getByLabel('Als neues Element anlegen'));
	await expect(
		playbookSelect.getByRole('option', { name: 'TÜV / Hauptuntersuchung' })
	).toBeAttached();
	await expect(
		playbookSelect.getByRole('option', { name: 'Vehicle inspection (TÜV / HU)' })
	).toHaveCount(0);
	await routeForm.getByLabel('Titel').fill('Inbox playbook item');
	await playbookSelect.selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await checkVisible(routeForm.getByLabel('Ich habe die Zuordnung geprüft.'));
	await activate(routeForm.getByRole('button', { name: 'Element anlegen und ablegen' }));
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+#attachment-/);
	await expect(
		page.locator('.fields-view .document-row', { hasText: 'inbox-playbook.pdf' })
	).toBeVisible();
});

test('shows bounded fake AI suggestions without exposing document or provider content', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Document candidate');
	await page.getByRole('button', { name: 'Anlegen' }).click();

	await page.goto('/settings');
	await page.getByLabel('Ich habe verstanden, dass ausgewählte Dokumente an OpenAI').check();
	await page.getByRole('button', { name: 'Einschalten' }).click();

	await uploadInboxDocument(page, 'inbox-ai.pdf');
	const detail = inboxDetail(page);
	await activate(detail.getByRole('button', { name: 'KI-Vorschlag erstellen' }));
	await expect(detail).toContainText('Vorschlag');
	await expect(detail).toContainText('Document candidate');
	await expect(detail).not.toContainText('%PDF-1.4');
	await expect(detail).not.toContainText('fake-v1');
	await expect(inboxRow(page, 'inbox-ai.pdf')).toContainText('Vorschlag');

	await activate(detail.getByRole('button', { name: 'Dokument löschen' }));
	await page.goto('/settings');
	await page.getByRole('button', { name: 'Ausschalten' }).click();
});

test('opens only the selected pending document without JavaScript', async ({ page }) => {
	try {
		await uploadInboxDocument(page, 'inbox-first.pdf');
		await uploadInboxDocument(page, 'inbox-second.pdf');

		const firstRow = inboxRow(page, 'inbox-first.pdf');
		const secondRow = inboxRow(page, 'inbox-second.pdf');
		await expect(page.locator('.inbox-detail form[action="?/route"]')).toHaveCount(1);
		await expect(
			inboxDetail(page).getByRole('heading', { name: 'inbox-second.pdf', level: 2 })
		).toBeVisible();
		await expect(
			secondRow.getByRole('link', { name: 'Ausgewähltes Dokument öffnen: inbox-second.pdf' })
		).toHaveCount(1);
		await expect(
			firstRow.getByRole('link', { name: 'Dokument öffnen: inbox-first.pdf' })
		).toHaveCount(1);

		await activate(firstRow.locator('a[href*="/inbox?doc="]'));
		await expect(page).toHaveURL(/\/inbox\?doc=[0-9a-f-]+/);
		await expect(
			inboxDetail(page).getByRole('heading', { name: 'inbox-first.pdf', level: 2 })
		).toBeVisible();
		await expect(
			firstRow.getByRole('link', { name: 'Ausgewähltes Dokument öffnen: inbox-first.pdf' })
		).toHaveCount(1);
		await expect(
			secondRow.getByRole('link', { name: 'Dokument öffnen: inbox-second.pdf' })
		).toHaveCount(1);
	} finally {
		await deleteIfPending(page, 'inbox-first.pdf');
		await deleteIfPending(page, 'inbox-second.pdf');
	}
});
