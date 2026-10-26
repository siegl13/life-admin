import { expect, test, type Locator, type Page } from '@playwright/test';

const MINIMAL_PDF = Buffer.from('%PDF-1.4\n%%EOF');
const MINIMAL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+qHy+9QAAAABJRU5ErkJggg==',
	'base64'
);

async function createItem(page: Page, title: string) {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
}

for (const width of [375, 390, 430]) {
	test(`upload picker shows the selected file and replaces it without uploading (${width}px)`, async ({
		page
	}) => {
		await page.setViewportSize({ width, height: 800 });
		await createItem(page, `Upload Summary ${width}`);

		const form = page.locator('form[action="?/addAttachment"]');
		const picker = form.locator('.upload-picker');
		const summary = form.locator('.upload-summary');
		await expect(picker).toContainText('Datei auswählen');
		await expect(summary).toHaveCount(0);

		const input = form.locator('input[type="file"]');
		await input.setInputFiles({
			name: 'vertrag-mit-einem-sehr-langen-dateinamen-2026.pdf',
			mimeType: 'application/pdf',
			buffer: MINIMAL_PDF
		});
		await expect(summary).toContainText('Ausgewählt');
		await expect(summary).toContainText('vertrag-mit-einem-sehr-langen-dateinamen-2026.pdf');
		await expect(summary).toContainText('PDF');
		await expect(summary).toContainText(/\d+ B/);
		await expect(picker).toContainText('Datei ändern');
		await expect(form.getByRole('button', { name: 'Hinzufügen' })).toBeVisible();

		await input.setInputFiles({ name: 'bild.png', mimeType: 'image/png', buffer: MINIMAL_PNG });
		await expect(summary).toContainText('bild.png');
		await expect(summary).toContainText('PNG');
		await expect(summary).not.toContainText('vertrag-mit');

		// Choosing another file never uploads by itself.
		await expect(page.locator('.attachment-manage-row')).toHaveCount(0);
		await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);

		await form.getByRole('button', { name: 'Hinzufügen' }).click();
		await expect(page.locator('.fields-view .document-row', { hasText: 'bild.png' })).toBeVisible();
	});
}

test('inbox picker shows the selected file and keeps the explicit submit', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 800 });
	await page.goto('/inbox');
	const form = page.locator('form[action="?/upload"]').first();
	await expect(form.locator('.upload-summary')).toHaveCount(0);
	await form.locator('input[type="file"]').setInputFiles({
		name: 'upload-ux-inbox.pdf',
		mimeType: 'application/pdf',
		buffer: MINIMAL_PDF
	});
	await expect(form.locator('.upload-summary')).toContainText('upload-ux-inbox.pdf');
	await expect(form.locator('.upload-picker')).toContainText('Datei ändern');
	await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375);
});

test('featured action controls are primary, and reopen stays', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 800 });
	await createItem(page, 'Action Controls Test');
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
	const addAction = page.locator('form[action="?/addManualAction"]');
	await addAction.getByLabel('Bezeichnung der Aufgabe').fill('Undated task');
	await addAction.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
	await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
	await addAction.getByLabel('Bezeichnung der Aufgabe').fill('Dated task');
	await addAction.getByLabel('Fällig am (optional)').fill('2099-01-01');
	await addAction.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();

	// The hero card owns the featured action controls at every width.
	const hero = page.locator('.next-up');
	await expect(hero.getByRole('button', { name: 'Erledigen' })).toBeVisible();
	await expect(hero.getByRole('button', { name: 'Überspringen' })).toBeVisible();

	await hero.getByRole('button', { name: 'Erledigen' }).click();
	await page.locator('summary', { hasText: 'Erledigt und übersprungen' }).click();
	await expect(page.getByRole('button', { name: 'Wieder öffnen' })).toHaveCount(1);
});

test('What’s Next rows show Erledigen and Überspringen without a menu, dated or not', async ({
	page
}) => {
	await createItem(page, 'WN Primary Controls');
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
	const addAction = page.locator('form[action="?/addManualAction"]');
	await addAction.getByLabel('Bezeichnung der Aufgabe').fill('WN undated');
	await addAction.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
	await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
	await addAction.getByLabel('Bezeichnung der Aufgabe').fill('WN dated');
	await addAction.getByLabel('Fällig am (optional)').fill('2099-01-01');
	await addAction.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();

	await page.goto('/');
	for (const title of ['WN undated', 'WN dated']) {
		const row = page.locator('.action-row', { hasText: title });
		await expect(row.getByRole('button', { name: `Erledigen: ${title}` })).toBeVisible();
		await expect(row.getByRole('button', { name: `Überspringen: ${title}` })).toBeVisible();
	}
	await page
		.locator('.action-row', { hasText: 'WN undated' })
		.getByRole('button', { name: /Überspringen/ })
		.click();
	await expect(page.locator('.action-row', { hasText: 'WN undated' })).toHaveCount(0);
});

type PendingSnapshot = { busy: string | null; text: string; disabled: boolean[] };

/**
 * Holds the real POST for `action` on the server side of the route until the
 * page has recorded what the form looked like while the request was in
 * flight. Playwright locators wait for a started navigation, so the pending
 * DOM cannot be read from the test while the response is held. Instead the
 * page snapshots the form into sessionStorage (it survives the navigation)
 * and signals through an exposed binding; only then is the request released
 * and the test reads the snapshot on the page that the response produced.
 * Native submission is not cancelled.
 */
async function holdSubmission(page: Page, form: Locator, action: string) {
	let taken!: () => void;
	const snapshotTaken = new Promise<void>((resolve) => (taken = resolve));
	let requestSeen = false;
	const binding = `__pendingSnapshotTaken_${action}`;
	await page.exposeFunction(binding, () => taken());
	await page.route(
		(url) => url.search.includes(action),
		async (route) => {
			if (route.request().method() !== 'POST') return route.continue();
			requestSeen = true;
			await snapshotTaken;
			await route.continue();
		}
	);
	await form.evaluate((node, bindingName) => {
		node.addEventListener('submit', () => {
			setTimeout(() => {
				const snapshot = {
					busy: node.getAttribute('aria-busy'),
					text: node.textContent ?? '',
					disabled: Array.from(node.querySelectorAll('button')).map((button) => button.disabled)
				};
				sessionStorage.setItem('pendingSnapshot', JSON.stringify(snapshot));
				(window as unknown as Record<string, () => void>)[bindingName]();
			}, 100);
		});
	}, binding);
	return {
		async read(): Promise<PendingSnapshot> {
			expect(requestSeen).toBe(true);
			const raw = await page.evaluate(() => sessionStorage.getItem('pendingSnapshot'));
			expect(raw).not.toBeNull();
			return JSON.parse(raw!) as PendingSnapshot;
		}
	};
}

test('upload shows a pending state while the request is in flight, then the document', async ({
	page
}) => {
	await createItem(page, 'Upload Pending Test');
	const form = page.locator('form[action="?/addAttachment"]');
	await form
		.locator('input[type="file"]')
		.setInputFiles({ name: 'pending.pdf', mimeType: 'application/pdf', buffer: MINIMAL_PDF });

	const held = await holdSubmission(page, form, 'addAttachment');
	await form.getByRole('button', { name: 'Hinzufügen' }).click();

	// The response arrived: the document is stored and the picker is idle again.
	await expect(
		page.locator('.fields-view .document-row', { hasText: 'pending.pdf' })
	).toBeVisible();
	await expect(page.locator('form[action="?/addAttachment"] .upload-summary')).toHaveCount(0);

	const pending = await held.read();
	expect(pending.busy).toBe('true');
	expect(pending.text).toContain('Wird hochgeladen…');
	expect(pending.text).toContain('pending.pdf');
	expect(pending.disabled).toContain(true);
});

test('analysis shows a pending state in the Inbox and on the document page', async ({ page }) => {
	await page.goto('/settings');
	await page.getByLabel('Ich habe verstanden, dass ausgewählte Dokumente an OpenAI').check();
	await page.getByRole('button', { name: 'Einschalten' }).click();
	try {
		await createItem(page, 'Analysis Pending Test');
		const attach = page.locator('form[action="?/addAttachment"]');
		await attach.locator('input[type="file"]').setInputFiles({
			name: 'analyse-pending.pdf',
			mimeType: 'application/pdf',
			buffer: MINIMAL_PDF
		});
		await attach.getByRole('button', { name: 'Hinzufügen' }).click();
		await page.getByRole('link', { name: 'analyse-pending.pdf' }).click();

		const extract = page.locator('form[action="?/extract"]');
		const heldExtract = await holdSubmission(page, extract, 'extract');
		await extract.getByRole('button', { name: 'Informationen erkennen' }).click();
		await expect(page).toHaveURL(/\/suggestions\//);
		const extractPending = await heldExtract.read();
		expect(extractPending.busy).toBe('true');
		expect(extractPending.text).toContain('Analyse läuft…');
		expect(extractPending.text).toContain('Bitte warten');
		expect(extractPending.disabled).toContain(true);

		await page.goto('/inbox');
		const upload = page.locator('form[action="?/upload"]').first();
		await upload.locator('input[type="file"]').setInputFiles({
			name: 'inbox-analyse-pending.pdf',
			mimeType: 'application/pdf',
			buffer: MINIMAL_PDF
		});
		await upload.getByRole('button', { name: 'In Eingang ablegen' }).click();
		const analyze = page.locator('.inbox-detail button[formaction="?/analyze"]');
		const heldAnalyze = await holdSubmission(
			page,
			page.locator('.inbox-detail form.route-form'),
			'analyze'
		);
		await analyze.click();
		// The response arrived: the document carries a suggestion and the
		// analyze control is idle again.
		await expect(
			page.getByRole('listitem').filter({ hasText: 'inbox-analyse-pending.pdf' })
		).toContainText('Vorschlag');
		const analyzePending = await heldAnalyze.read();
		expect(analyzePending.busy).toBe('true');
		expect(analyzePending.text).toContain('Analyse läuft…');
		expect(analyzePending.text).toContain('Bitte warten');
		expect(analyzePending.disabled).toContain(true);
		await expect(page.locator('.inbox-detail button[formaction="?/analyze"]')).toBeEnabled();
	} finally {
		try {
			await page.goto('/inbox');
			const row = page.getByRole('listitem').filter({
				has: page.getByRole('heading', { name: 'inbox-analyse-pending.pdf', level: 3 })
			});
			if (await row.count()) {
				await row.locator('a[href*="/inbox?doc="]').click();
				await expect(page.locator('.inbox-detail')).toContainText('inbox-analyse-pending.pdf');
				await page.locator('.inbox-detail button[formaction="?/delete"]').click();
				await expect(row).toHaveCount(0);
			}
		} finally {
			await page.goto('/settings');
			await page.getByRole('button', { name: 'Ausschalten' }).click();
		}
	}
});
