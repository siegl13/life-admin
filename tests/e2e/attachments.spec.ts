import { expect, test } from '@playwright/test';

/**
 * Scoped to its own item, because the e2e run shares one database across
 * every spec (see playwright.config.ts). A minimal valid PDF is built
 * in-memory (no committed fixture needed) rather than a real scanned
 * document.
 */
const MINIMAL_PDF = Buffer.from('%PDF-1.4\n%%EOF');
const MINIMAL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+qHy+9QAAAABJRU5ErkJggg==',
	'base64'
);

async function createItem(page: import('@playwright/test').Page, title: string): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	return page.url();
}

test('a document can be uploaded, downloaded, and removed from an item', async ({ page }) => {
	await createItem(page, 'Attachment Upload Test');
	await expect(page.getByRole('heading', { name: 'Dokumente', level: 2 })).toBeVisible();

	// "Dokumente verwalten" defaults open on a fresh item (nothing to show
	// read-only yet) — no click needed to reach the upload form.
	await page
		.locator('form[action="?/addAttachment"]')
		.locator('input[type="file"]')
		.setInputFiles({ name: 'vertrag.pdf', mimeType: 'application/pdf', buffer: MINIMAL_PDF });
	await page
		.locator('form[action="?/addAttachment"]')
		.getByRole('button', { name: 'Hinzufügen' })
		.click();

	// Scoped to the read-only list (`.fields-view`): once an item has an
	// attachment, "Dokumente verwalten" defaults to closed and the same
	// filename also exists (hidden) in the still-in-DOM manage list.
	const row = page.locator('.fields-view .document-row', { hasText: 'vertrag.pdf' });
	await expect(row).toBeVisible();
	await expect(page.getByRole('button', { name: 'Informationen erkennen' })).toHaveCount(0);

	const href = await row.getByRole('link', { name: 'vertrag.pdf' }).getAttribute('href');
	expect(href).toBeTruthy();
	const viewerResponse = await page.request.get(href!);
	expect(viewerResponse.headers()['content-security-policy']).toContain("object-src 'self'");
	expect(viewerResponse.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
	await page.goto(href!);
	const previewHref = await page.locator('object[type="application/pdf"]').getAttribute('data');
	expect(previewHref).toBeTruthy();
	const preview = await page.request.get(previewHref!);
	expect(preview.headers()['content-disposition']).toContain('inline');
	expect(preview.headers()['x-frame-options']).toBe('SAMEORIGIN');
	expect(preview.headers()['x-content-type-options']).toBe('nosniff');
	expect(await preview.body()).toEqual(MINIMAL_PDF);
	const downloadHref = await page
		.getByRole('link', { name: 'Herunterladen' })
		.first()
		.getAttribute('href');
	const download = await page.request.get(downloadHref!);
	expect(download.headers()['content-disposition']).toContain('attachment');
	expect(download.headers()['x-frame-options']).toBe('DENY');
	expect(await download.body()).toEqual(MINIMAL_PDF);

	await page.getByLabel('Anzeigename').fill('  Hausvertrag  ');
	await page.getByRole('button', { name: 'Dokumentnamen speichern' }).click();
	await expect(page.getByRole('heading', { name: 'Hausvertrag' })).toBeVisible();
	await page.getByRole('link', { name: /Zurück zu/ }).click();
	await expect(page.locator('.fields-view .document-row')).toContainText('Hausvertrag');
	await expect(page.locator('.fields-view .document-row')).toContainText(
		'Originaldatei: vertrag.pdf'
	);

	const attachments = page.locator('section[aria-labelledby="attachments-label"]');
	await attachments.locator('summary', { hasText: 'Dokumente verwalten' }).click();
	await attachments
		.locator('.attachment-manage-row', { hasText: 'vertrag.pdf' })
		.getByRole('button', { name: 'Entfernen' })
		.click();
	await expect(attachments.getByText('vertrag.pdf')).toHaveCount(0);
	await expect(attachments.locator('details').getByText('Noch keine Dokumente.')).toBeVisible();
});

test('an SVG file renamed to .png is rejected and never appears in the list', async ({ page }) => {
	await createItem(page, 'Attachment Rejection Test');
	const svgAsPng = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

	await page
		.locator('form[action="?/addAttachment"]')
		.locator('input[type="file"]')
		.setInputFiles({ name: 'bild.png', mimeType: 'image/png', buffer: svgAsPng });
	await page
		.locator('form[action="?/addAttachment"]')
		.getByRole('button', { name: 'Hinzufügen' })
		.click();

	await expect(page.locator('.document-row', { hasText: 'bild.png' })).toHaveCount(0);
	await expect(page.getByText('Dieser Dateityp wird nicht unterstützt')).toBeVisible();
});

test('an image is previewed inline through the authenticated content route', async ({ page }) => {
	await createItem(page, 'Attachment Image Preview Test');
	await page.locator('form[action="?/addAttachment"] input[type="file"]').setInputFiles({
		name: 'bild.png',
		mimeType: 'image/png',
		buffer: MINIMAL_PNG
	});
	await page
		.locator('form[action="?/addAttachment"]')
		.getByRole('button', { name: 'Hinzufügen' })
		.click();

	const row = page.locator('.fields-view .document-row', { hasText: 'bild.png' });
	await expect(row.locator('img')).toBeVisible();
	await row.getByRole('link', { name: 'bild.png' }).click();
	const previewHref = await page.locator('.document-viewer__image img').getAttribute('src');
	expect(previewHref).toBeTruthy();
	const preview = await page.request.get(previewHref!);
	expect(preview.headers()['content-disposition']).toContain('inline');
	expect(preview.headers()['x-frame-options']).toBe('DENY');
	expect(preview.headers()['x-content-type-options']).toBe('nosniff');
	expect(await preview.body()).toEqual(MINIMAL_PNG);
});

test('an upload over the 10 MB limit is rejected without ever appearing on the item', async ({
	page
}) => {
	await createItem(page, 'Attachment Too Large Test');
	const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 1);

	await page
		.locator('form[action="?/addAttachment"]')
		.locator('input[type="file"]')
		.setInputFiles({ name: 'riesig.pdf', mimeType: 'application/pdf', buffer: oversized });
	await page
		.locator('form[action="?/addAttachment"]')
		.getByRole('button', { name: 'Hinzufügen' })
		.click();

	await expect(page.locator('.document-row', { hasText: 'riesig.pdf' })).toHaveCount(0);
	await expect(page.getByText('Die Datei ist zu groß (höchstens 10 MB).')).toBeVisible();
});

test('two documents with the same filename both stay on the item', async ({ page }) => {
	await createItem(page, 'Attachment Duplicate Name Test');

	for (let i = 0; i < 2; i++) {
		// Open by default on the fresh item (i === 0); after the first
		// upload the panel defaults closed again, so it needs an explicit
		// click from the second iteration onward.
		if (i > 0) {
			await page.locator('summary', { hasText: 'Dokumente verwalten' }).click();
		}
		await page
			.locator('form[action="?/addAttachment"]')
			.locator('input[type="file"]')
			.setInputFiles({ name: 'rechnung.pdf', mimeType: 'application/pdf', buffer: MINIMAL_PDF });
		await page
			.locator('form[action="?/addAttachment"]')
			.getByRole('button', { name: 'Hinzufügen' })
			.click();
	}

	// Scoped to the read-only list: both filenames also exist (hidden) in
	// the manage list, which stays in the DOM behind the closed disclosure.
	await expect(page.locator('.fields-view .document-row', { hasText: 'rechnung.pdf' })).toHaveCount(
		2
	);
});

/**
 * Regression: the "Entfernen" button for each row used to sit before the
 * form's own "Dokumentnamen speichern" button in DOM order, so a plain
 * Enter keypress in a display-name field triggered the browser's implicit
 * form submission via that first "Entfernen" button instead — silently
 * deleting the document instead of renaming it. The save button is now
 * first in DOM order (only reordered visually via CSS), so it is the
 * form's default submit again.
 */
test('pressing Enter in the display-name field saves the name, not deletes the document', async ({
	page
}) => {
	await createItem(page, 'Attachment Enter Key Test');

	await page
		.locator('form[action="?/addAttachment"]')
		.locator('input[type="file"]')
		.setInputFiles({ name: 'police.pdf', mimeType: 'application/pdf', buffer: MINIMAL_PDF });
	await page
		.locator('form[action="?/addAttachment"]')
		.getByRole('button', { name: 'Hinzufügen' })
		.click();

	await page.locator('summary', { hasText: 'Dokumente verwalten' }).click();
	await page.getByLabel('Anzeigename').fill('Versicherungspolice');
	await page.getByLabel('Anzeigename').press('Enter');

	await expect(page.locator('.fields-view .document-row')).toContainText('Versicherungspolice');
	await expect(page.locator('.fields-view .document-row')).toContainText(
		'Originaldatei: police.pdf'
	);
});

test('viewer and content routes do not disclose guessed, mismatched, or anonymous ids', async ({
	page
}) => {
	const firstItemUrl = await createItem(page, 'Attachment Authorization Source');
	await page
		.locator('form[action="?/addAttachment"] input[type="file"]')
		.setInputFiles({ name: 'private.pdf', mimeType: 'application/pdf', buffer: MINIMAL_PDF });
	await page
		.locator('form[action="?/addAttachment"]')
		.getByRole('button', { name: 'Hinzufügen' })
		.click();
	const viewerHref = await page
		.locator('.fields-view .document-row')
		.getByRole('link', { name: 'private.pdf' })
		.getAttribute('href');
	expect(viewerHref).toBeTruthy();
	const secondItemUrl = await createItem(page, 'Attachment Authorization Target');
	const attachmentId = viewerHref!.split('/').at(-1)!;
	const mismatchedViewer = `${secondItemUrl}/attachments/${attachmentId}`;
	for (const url of [
		mismatchedViewer,
		`${mismatchedViewer}/content`,
		`${firstItemUrl}/attachments/guessed`
	]) {
		const response = await page.request.get(url);
		expect(response.status()).toBe(404);
	}

	await page.context().clearCookies();
	const anonymousContent = await page.request.get(`${viewerHref}/content`);
	expect(anonymousContent.url()).toMatch(/\/login\?redirectTo=/);
	expect(anonymousContent.headers()['content-disposition']).toBeUndefined();
	await page.goto(viewerHref!);
	await expect(page).toHaveURL(/\/login\?redirectTo=/);
});

test('document rows remain usable without horizontal overflow at mobile boundaries', async ({
	page
}) => {
	await createItem(page, 'Attachment Mobile Test');
	await page.locator('form[action="?/addAttachment"] input[type="file"]').setInputFiles({
		name: 'sehr-langer-originaler-dateiname-fuer-das-dokument.pdf',
		mimeType: 'application/pdf',
		buffer: MINIMAL_PDF
	});
	await page
		.locator('form[action="?/addAttachment"]')
		.getByRole('button', { name: 'Hinzufügen' })
		.click();

	for (const width of [375, 640]) {
		await page.setViewportSize({ width, height: 800 });
		await expect(page.locator('.app-topbar .button')).toHaveCount(1);
		await expect(page.locator('.topbar-search-link')).toHaveAccessibleName('Suchen');
		await expect(page.locator('.topbar-search-link')).toHaveText('');
		await expect(page.locator('.topbar-logout')).toHaveAttribute('method', 'POST');
		expect(
			await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth),
			`page must not overflow at ${width}px`
		).toBe(true);
		const targets = page.locator('.app-topbar a, .app-topbar button, .document-row a');
		for (let index = 0; index < (await targets.count()); index++) {
			const box = await targets.nth(index).boundingBox();
			if (box) expect(box.height).toBeGreaterThanOrEqual(44);
		}
	}
});

test.describe('document forms without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('aggregate rename, viewer download, and delete use ordinary forms and links', async ({
		page
	}) => {
		await createItem(page, 'Attachment No JS Test');
		await page
			.locator('form[action="?/addAttachment"] input[type="file"]')
			.setInputFiles({ name: 'no-js.pdf', mimeType: 'application/pdf', buffer: MINIMAL_PDF });
		await page
			.locator('form[action="?/addAttachment"]')
			.getByRole('button', { name: 'Hinzufügen' })
			.click();
		await page.locator('summary', { hasText: 'Dokumente verwalten' }).click();
		await page.getByLabel('Anzeigename').fill('Ohne JavaScript');
		await page.getByRole('button', { name: 'Dokumentnamen speichern' }).click();
		await expect(page.locator('.fields-view .document-row')).toContainText('Ohne JavaScript');
		await page.getByRole('link', { name: 'Ohne JavaScript' }).click();
		await expect(page.getByRole('link', { name: 'Herunterladen' }).first()).toHaveAttribute(
			'href',
			/content\?download=1$/
		);
		await page.getByRole('link', { name: /Zurück zu/ }).click();
		await page.locator('summary', { hasText: 'Dokumente verwalten' }).click();
		await page.getByRole('button', { name: 'Entfernen' }).click();
		await expect(page.getByText('Noch keine Dokumente.').first()).toBeVisible();
	});
});
