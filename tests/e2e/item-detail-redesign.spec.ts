import { expect, test } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4173';
const createdItems = new WeakMap<import('@playwright/test').Page, string[]>();

/**
 * Phase 3 item-detail redesign: one hero per viewport (desktop buttons,
 * phone sticky bar), facts grouped by Field.type with an empty-fields
 * disclosure and no duplicate overview values, a desktop side column for
 * documents/relations/history, and a compact workflow progress summary.
 * See +page.svelte,
 * WorkflowTimeline.svelte.
 */

async function createTuvItem(
	page: import('@playwright/test').Page,
	title: string
): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemId = page.url().split('/').pop()!;
	createdItems.set(page, [...(createdItems.get(page) ?? []), itemId]);
	return itemId;
}

async function createGenericItem(
	page: import('@playwright/test').Page,
	title: string
): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemId = page.url().split('/').pop()!;
	createdItems.set(page, [...(createdItems.get(page) ?? []), itemId]);
	return itemId;
}

test.afterEach(async ({ page }) => {
	for (const itemId of createdItems.get(page) ?? []) {
		await page.request.post(`/items/${itemId}?/archiveItem`, {
			form: {},
			headers: { accept: 'text/html', origin: ORIGIN }
		});
	}
	createdItems.delete(page);
});

test('desktop hero owns complete/skip/change-due; the featured step shows neither', async ({
	page
}) => {
	await createTuvItem(page, 'Redesign Desktop Hero Test');
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	const hero = page.locator('.next-up');
	await expect(hero.getByRole('button', { name: 'Erledigen' })).toBeVisible();
	await expect(hero.getByRole('button', { name: 'Überspringen' })).toBeVisible();
	await expect(hero.getByRole('button', { name: 'Termin ändern' })).toBeVisible();
	await expect(hero.locator('.next-up__state')).toContainText(/\d+ (Tag|Tage) (übrig|überfällig)/);
	await expect(page.locator('.sticky-action-bar')).toBeHidden();

	const featuredStep = page.locator('.timeline__step').filter({
		has: page.locator('.timeline__title', { hasText: 'HU-Termin planen' })
	});
	await expect(featuredStep.getByRole('button', { name: 'Erledigen' })).toHaveCount(0);
	await expect(featuredStep.getByRole('button', { name: 'Überspringen' })).toHaveCount(0);
	await expect(featuredStep.getByRole('button', { name: 'Termin ändern' })).toHaveCount(0);
	await expect(featuredStep.locator('.timeline__body > .meta')).toHaveCount(0);
});

test('desktop hero completes the featured action and workflow reopen restores it', async ({
	page
}) => {
	await createTuvItem(page, 'Redesign Hero Undo Test');
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	await page.locator('.next-up').getByRole('button', { name: 'Erledigen' }).click();
	const featured = page.locator('.timeline__step').filter({
		has: page.locator('.timeline__title', { hasText: 'HU-Termin planen' })
	});
	await expect(featured).toContainText('Erledigt');
	await featured.getByRole('button', { name: 'Wieder öffnen' }).click();
	await expect(page.locator('.next-up__action')).toHaveText('HU-Termin planen');
});

test('mobile sticky action completes the featured action and workflow reopen restores it', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await createTuvItem(page, 'Redesign Mobile Undo Test');
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	await page.locator('.sticky-action-bar').getByRole('button', { name: 'Erledigen' }).click();
	const featured = page.locator('.timeline__step').filter({
		has: page.locator('.timeline__title', { hasText: 'HU-Termin planen' })
	});
	await expect(featured).toContainText('Erledigt');
	await featured.getByRole('button', { name: 'Wieder öffnen' }).click();
	await expect(page.locator('.next-up__action')).toHaveText('HU-Termin planen');
});

test('snoozing the featured action keeps the exact due date only in the hero', async ({ page }) => {
	await createTuvItem(page, 'Redesign Featured Snooze Test');
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	const heroDate = page.locator('.next-up__state');
	await expect(heroDate).toContainText('1. Dezember 2025');
	const featuredStep = page.locator('.timeline__step').filter({
		has: page.locator('.timeline__title', { hasText: 'HU-Termin planen' })
	});
	await featuredStep.getByRole('button', { name: 'Später erinnern' }).click();
	await featuredStep
		.getByRole('dialog', { name: 'Später erinnern' })
		.getByRole('button', { name: 'Morgen' })
		.click();
	await expect(featuredStep).toContainText('Erneut erinnern am');
	await expect(heroDate).toContainText('1. Dezember 2025');
	await expect(featuredStep.locator('.timeline__body > .meta')).toHaveCount(0);
});

test.describe('item detail forms without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('the due dialog form and sticky complete form submit as ordinary POSTs', async ({
		page
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await createTuvItem(page, 'Redesign No JavaScript Test');
		await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
		await page.locator('input[type="date"]').first().fill('2026-01-01');
		await page.getByRole('button', { name: 'Speichern' }).click();

		const sticky = page.locator('.sticky-action-bar');
		const actionId = await sticky.locator('input[name="actionId"]').getAttribute('value');
		const dialog = page.locator(`#due-dialog-${actionId}`);
		await expect(dialog).toBeVisible();
		await dialog.locator('input[name="dueDate"]').fill('2026-01-15');
		await dialog.getByRole('button', { name: 'Termin speichern' }).click();
		await expect(page.locator('.next-up__state')).toContainText('15. Januar 2026');

		await sticky.getByRole('button', { name: 'Erledigen' }).click();
		const firstStep = page.locator('.timeline__step').filter({
			has: page.locator('.timeline__title', { hasText: 'HU-Termin planen' })
		});
		await expect(firstStep).toContainText('Erledigt');
	});
});

test('mobile: hero is informational only, one sticky bar owns complete + a secondary menu', async ({
	page
}) => {
	await page.setViewportSize({ width: 375, height: 667 });
	await createTuvItem(page, 'Redesign Mobile Sticky Test');
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	const hero = page.locator('.next-up');
	await expect(hero.locator('.next-up__actions')).toBeHidden();

	const stickyBar = page.locator('.sticky-action-bar');
	await expect(stickyBar).toBeVisible();
	await expect(page.getByRole('link', { name: 'Neues Element' })).toHaveCount(0);
	await expect(stickyBar.getByRole('button', { name: 'Erledigen' })).toBeVisible();
	await expect(stickyBar.getByRole('button', { name: 'Überspringen' })).toHaveCount(0);

	await stickyBar.locator('summary').click();
	const dueTrigger = stickyBar.getByRole('button', { name: 'Termin ändern' });
	await expect(stickyBar.getByRole('button', { name: 'Überspringen' })).toBeVisible();
	await expect(dueTrigger).toBeVisible();

	// The sticky trigger opens the very dialog WorkflowTimeline renders for
	// this action (see #41) — no second editor. TÜV has 4 derived steps,
	// each with its own identically-worded dialog, so scope by this one's id.
	const actionId = await stickyBar.locator('input[name="actionId"]').getAttribute('value');
	const dueDialog = page.locator(`#due-dialog-${actionId}`);
	await expect(dueDialog).not.toBeVisible();
	await dueTrigger.click();
	await expect(dueDialog).toBeVisible();
	await expect(dueDialog.getByText('Aktuell: 1. Dezember 2025')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dueDialog).not.toBeVisible();

	await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375);
});

test('item detail action ownership follows the shell breakpoint at 767px and 768px', async ({
	page
}) => {
	await createTuvItem(page, 'Redesign Breakpoint Detail Test');
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	for (const width of [641, 767, 768]) {
		await page.setViewportSize({ width, height: 844 });
		await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
		if (width < 768) {
			await expect(page.locator('.sticky-action-bar')).toBeVisible();
			await expect(page.locator('.next-up__actions')).toBeHidden();
			await expect(page.locator('.timeline-progress')).toBeVisible();
		} else {
			await expect(page.locator('.sticky-action-bar')).toBeHidden();
			await expect(page.locator('.next-up__actions')).toBeVisible();
			await expect(page.locator('.timeline-progress')).toBeVisible();
		}
		await expect(page.locator('.timeline-bar')).toHaveCount(0);
	}
});

test('no open action: calm informational empty state, no sticky bar', async ({ page }) => {
	const itemId = await createTuvItem(page, 'Redesign No Open Action Test');
	await expect(page.locator('.next-up__action')).toHaveText('Keine offene Aufgabe');
	await expect(page.locator('.sticky-action-bar')).toHaveCount(0);
	const hint = page.locator('.next-up .hint');
	for (const theme of ['light', 'dark']) {
		await page.goto('/settings');
		await page.locator(`button[name="theme"][value="${theme}"]`).click();
		await page.goto(`/items/${itemId}`);
		const contrast = await hint.evaluate((element) => {
			function luminance(color: string): number {
				const channels = color
					.match(/[\d.]+/g)!
					.slice(0, 3)
					.map(Number)
					.map((value) => {
						const channel = value / 255;
						return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
					});
				return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
			}
			const foreground = luminance(getComputedStyle(element).color);
			const background = luminance(getComputedStyle(element.closest('.next-up')!).backgroundColor);
			return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
		});
		expect(contrast).toBeGreaterThanOrEqual(4.5);
	}
});

test('cycle-completion hero hint keeps readable contrast in both themes', async ({ page }) => {
	const itemId = await createTuvItem(page, 'Redesign Cycle Completion Contrast Test');
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();
	for (const action of [
		'HU-Termin planen',
		'Fahrzeug / Unterlagen vorbereiten',
		'Hauptuntersuchung durchführen',
		'Neue HU eintragen'
	]) {
		await expect(page.locator('.next-up__action')).toHaveText(action);
		await page.locator('.next-up').getByRole('button', { name: 'Erledigen' }).click();
	}

	const completion = page.locator('.next-up').filter({
		has: page.locator('.next-up__label', { hasText: 'Abschluss' })
	});
	await expect(completion).toBeVisible();
	for (const theme of ['light', 'dark']) {
		await page.goto('/settings');
		await page.locator(`button[name="theme"][value="${theme}"]`).click();
		await page.goto(`/items/${itemId}`);
		const hint = page
			.locator('.next-up')
			.filter({
				has: page.locator('.next-up__label', { hasText: 'Abschluss' })
			})
			.locator('.hint');
		const contrast = await hint.evaluate((element) => {
			function luminance(color: string): number {
				const channels = color
					.match(/[\d.]+/g)!
					.slice(0, 3)
					.map((value) => {
						const channel = Number(value) / 255;
						return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
					});
				return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
			}
			const foreground = luminance(getComputedStyle(element).color);
			const background = luminance(getComputedStyle(element.closest('.next-up')!).backgroundColor);
			return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
		});
		expect(contrast).toBeGreaterThanOrEqual(4.5);
	}
});

test('archived item: no hero mutation card, no sticky bar, read-only', async ({ page }) => {
	await createTuvItem(page, 'Redesign Archived Test');
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await page.locator('summary', { hasText: 'Archivieren' }).click();
	await page.getByRole('button', { name: 'Archivieren', exact: true }).click();

	await expect(page.locator('.notice__title', { hasText: 'Archiviert' })).toBeVisible();
	await expect(page.locator('.next-up')).toHaveCount(0);
	await expect(page.locator('.sticky-action-bar')).toHaveCount(0);
	await expect(
		page.locator('.timeline__step').first().locator('.timeline__body > .meta')
	).toContainText('1. Dezember 2025');
});

test('desktop: progress summary is shown once, step names appear only in the list', async ({
	page
}) => {
	await createTuvItem(page, 'Redesign Step Bar Desktop Test');
	await expect(page.locator('.timeline-bar')).toHaveCount(0);
	const progress = page.locator('.timeline-progress');
	await expect(progress).toBeVisible();
	await expect(progress.locator('.timeline-progress__count')).toHaveText(
		'0 von 4 Schritten erledigt'
	);
	await expect(page.locator('.timeline__title')).toHaveCount(4);
	await expect(page.locator('.timeline__title').first()).toHaveText('HU-Termin planen');
});

test('mobile: progress summary tracks completed workflow steps', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 667 });
	await createTuvItem(page, 'Redesign Step Bar Mobile Test');
	await expect(page.locator('.timeline-bar')).toHaveCount(0);
	const progress = page.locator('.timeline-progress');
	await expect(progress).toBeVisible();
	await expect(progress.locator('.timeline-progress__count')).toHaveText(
		'0 von 4 Schritten erledigt'
	);

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await page.locator('.sticky-action-bar').getByRole('button', { name: 'Erledigen' }).click();
	await expect(progress.locator('.timeline-progress__count')).toHaveText(
		'1 von 4 Schritten erledigt'
	);
});

test('facts are grouped by type, only populated values show once, empty ones collapse with a correct count', async ({
	page
}) => {
	await createTuvItem(page, 'Redesign Facts Grouping Test');
	const fieldsPanel = page
		.locator('details.fields-panel')
		.filter({ has: page.locator('#fields-label') });
	await expect(fieldsPanel.locator(':scope > summary')).toContainText('Angaben bearbeiten');
	await expect(page.getByText('Angaben bearbeiten', { exact: true })).toHaveCount(1);
	await fieldsPanel.locator(':scope > summary').click();
	await expect(fieldsPanel).toHaveAttribute('open', '');
	await page.locator('summary', { hasText: 'Angabe hinzufügen' }).click();
	const addFieldForm = page.locator('form[action="?/addField"]');
	await addFieldForm.getByLabel('Bezeichnung', { exact: true }).fill('Preis');
	await addFieldForm.getByLabel('Typ').selectOption('currency');
	await addFieldForm.getByRole('button', { name: 'Angabe hinzufügen' }).click();

	// Redirects to `#field-c_preis`; a closed <details> is not auto-opened.
	if (!(await fieldsPanel.evaluate((node) => node instanceof HTMLDetailsElement && node.open))) {
		await fieldsPanel.locator(':scope > summary').click();
	}
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	const fahrzeugValue =
		'Beispiel Inspektionszentrum München Nord mit zusätzlichen Prüfstationen und Servicebereich für alle Fahrzeugtypen';
	await page.getByLabel('Fahrzeug').fill(fahrzeugValue);
	const vin = 'WVWZZZ' + '0123456789'.repeat(5);
	await page.locator('#vin').fill(vin);
	await page.locator('#field-c_preis input[type="text"]').fill('123.45');
	await page.getByRole('button', { name: 'Speichern' }).click();

	await expect(page.locator('.item-overview__value')).toHaveCount(0);
	await expect(page.locator('.facts-view')).toHaveCount(1);

	const groups = page.locator('.facts-group');
	await expect(groups).toHaveCount(3);
	await expect(groups.nth(0).locator('.facts-group__label')).toHaveText('Termine');
	await expect(groups.nth(0)).toContainText('Nächste HU');
	await expect(groups.nth(1).locator('.facts-group__label')).toHaveText('Beträge');
	await expect(groups.nth(1)).toContainText('123,45');
	await expect(groups.nth(2).locator('.facts-group__label')).toHaveText('Weitere Angaben');
	await expect(groups.nth(2)).toContainText(fahrzeugValue);
	await expect(groups.nth(2)).toContainText(vin);
	// Each populated fact renders exactly once across the page.
	await expect(page.getByText(fahrzeugValue)).toHaveCount(1);
	const vinValue = groups
		.nth(2)
		.locator('.data-row', { hasText: 'FIN' })
		.locator('.facts-group__value');
	await expect(vinValue).toHaveAttribute('title', vin);
	await expect(vinValue).toHaveAttribute('aria-label', vin);
	await expect(vinValue).toHaveCSS('white-space', 'nowrap');
	const vinLabel = groups.nth(2).locator('.data-row', { hasText: 'FIN' }).locator('.data-row__key');
	const labelColor = await vinLabel.evaluate((node) => getComputedStyle(node).color);
	const mutedColor = await page.evaluate(() =>
		getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim()
	);
	const resolvedMutedColor = await page.evaluate((color) => {
		const probe = document.createElement('span');
		probe.style.color = color;
		document.body.append(probe);
		const resolved = getComputedStyle(probe).color;
		probe.remove();
		return resolved;
	}, mutedColor);
	expect(labelColor).toBe(resolvedMutedColor);
	const valueFontSize = await vinValue.evaluate((node) =>
		parseFloat(getComputedStyle(node).fontSize)
	);
	const labelFontSize = await vinLabel.evaluate((node) =>
		parseFloat(getComputedStyle(node).fontSize)
	);
	expect(labelFontSize).toBeLessThan(valueFontSize);

	for (const width of [390, 768, 1280, 1440, 1920, 2560]) {
		await page.setViewportSize({ width, height: 900 });
		await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
		const factsWidth = await page
			.locator('.facts')
			.evaluate((node) => node.getBoundingClientRect().width);
		const vinLayout = await vinValue.evaluate((node) => ({
			clientWidth: node.clientWidth,
			scrollWidth: node.scrollWidth
		}));
		expect(vinLayout.scrollWidth).toBeGreaterThan(vinLayout.clientWidth);
		await expect(vinValue).toHaveCSS('white-space', 'nowrap');

		// An ordinary multiword value wraps onto more than one line instead
		// of truncating: its rendered text never overflows its own box, and
		// it is visibly taller than one text line.
		const fahrzeugValueLocator = groups
			.nth(2)
			.locator('.data-row', { hasText: 'Fahrzeug' })
			.locator('.facts-group__value');
		await expect(fahrzeugValueLocator).not.toHaveCSS('white-space', 'nowrap');
		const fahrzeugLayout = await fahrzeugValueLocator.evaluate((node) => ({
			clientWidth: node.clientWidth,
			scrollWidth: node.scrollWidth,
			height: node.getBoundingClientRect().height,
			lineHeight: parseFloat(getComputedStyle(node).lineHeight)
		}));
		expect(fahrzeugLayout.scrollWidth).toBeLessThanOrEqual(fahrzeugLayout.clientWidth + 1);
		if (width === 390) {
			// The single-column mobile width is narrow enough that this value
			// reliably wraps onto more than one line (unlike the wider desktop
			// two-column layout, where it may still fit on one).
			expect(fahrzeugLayout.height).toBeGreaterThan(fahrzeugLayout.lineHeight * 1.5);
		}

		for (const group of await groups.all()) {
			const groupWidth = await group.evaluate((node) => node.getBoundingClientRect().width);
			expect(groupWidth).toBeCloseTo(factsWidth, 0);
			const grid = await group.locator('.data-list').evaluate((node) => {
				const style = getComputedStyle(node);
				return {
					columns: style.gridTemplateColumns
						.split(' ')
						.map((value) => Number.parseFloat(value))
						.filter((value) => value > 0),
					columnGap: Number.parseFloat(style.columnGap),
					width: node.clientWidth
				};
			});
			expect(grid.columns.length).toBeGreaterThan(0);
			for (const columnWidth of grid.columns) expect(columnWidth).toBeGreaterThanOrEqual(223);
		}
	}

	const emptyDetails = page.locator('.facts-empty');
	await expect(emptyDetails.locator('summary')).toHaveText('2 leere Angaben');
	await emptyDetails.locator('summary').click();
	const plateRow = emptyDetails.locator('.data-row', { hasText: 'Kennzeichen' });
	await expect(plateRow).toContainText('hilfreich, aber nicht nötig');
	await plateRow.getByRole('link', { name: 'Ergänzen' }).click();
	await expect(page).toHaveURL(/#field-license_plate$/);
	// Same-document anchor navigation auto-expands the closed <details>
	// (unlike a fresh page load landing on a fragment, see
	// currency-field.spec.ts), so the target is visible without reopening.
	await expect(page.locator('#field-license_plate')).toBeVisible();
});

test('desktop side column holds documents, related items and history in that order', async ({
	page
}) => {
	const itemId = await createTuvItem(page, 'Redesign Side Column Test');
	const relatedTitle = 'Redesign Related Side Item';
	const relatedId = await createGenericItem(page, relatedTitle);
	await page.request.post(`/items/${itemId}?/linkItem`, {
		form: { relatedItemId: relatedId, q: '' },
		headers: { accept: 'text/html', origin: ORIGIN }
	});
	await page.goto(`/items/${itemId}`);
	const originalFilename = 'vehicle-annual-inspection-confirmation-report-for-family-car.pdf';
	const displayName = 'Family vehicle annual inspection and service confirmation report';
	await page.locator('form[action="?/addAttachment"] input[type="file"]').setInputFiles({
		name: originalFilename,
		mimeType: 'application/pdf',
		buffer: Buffer.from('%PDF-1.4\n%%EOF')
	});
	await page
		.locator('form[action="?/addAttachment"]')
		.getByRole('button', { name: 'Hinzufügen' })
		.click();
	await page.locator('summary', { hasText: 'Dokumente verwalten' }).click();
	await page.getByLabel('Anzeigename').fill(displayName);
	await page.getByRole('button', { name: 'Dokumentnamen speichern' }).click();
	// History only renders once there is at least one event.
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await page.locator('.next-up').getByRole('button', { name: 'Erledigen' }).click();
	const firstStep = page.locator('.timeline__step').filter({
		has: page.locator('.timeline__title', { hasText: 'HU-Termin planen' })
	});
	await firstStep.getByRole('button', { name: 'Wieder öffnen' }).click();

	const side = page.locator('.item-detail-side');
	const sectionIds = await side
		.locator(':scope > section')
		.evaluateAll((sections) => sections.map((s) => s.id));
	expect(sectionIds).toEqual(['attachments', 'relations', '']);
	await expect(side.locator('#history-label')).toBeVisible();
	await expect(side.locator('.history-event__text').first()).toHaveText('Aufgabe wieder geöffnet');
	const document = side.locator('.fields-view .document-row');
	const documentTitle = document.locator('.document-row__title');
	await expect(documentTitle).toHaveText(displayName);
	await expect(documentTitle).toHaveAttribute('title', displayName);
	await expect(documentTitle).toHaveCSS('white-space', 'nowrap');
	await expect(document.locator('.document-row__original')).toContainText(originalFilename);
	await expect(document.locator('.document-row__meta')).toHaveCSS('display', 'flex');
	await expect(document.locator('.document-row__date')).toHaveCSS('white-space', 'nowrap');
	for (const width of [1280, 390]) {
		await page.setViewportSize({ width, height: 900 });
		await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
		const titleWidth = await documentTitle.evaluate((node) => ({
			clientWidth: node.clientWidth,
			scrollWidth: node.scrollWidth
		}));
		expect(titleWidth.scrollWidth).toBeGreaterThan(titleWidth.clientWidth);
		const textBox = await document.locator('.document-row__text').boundingBox();
		const dateBox = await document.locator('.document-row__date').boundingBox();
		const openBox = await document.locator('.document-row__open').boundingBox();
		expect(textBox).not.toBeNull();
		expect(dateBox).not.toBeNull();
		expect(openBox).not.toBeNull();
		expect(dateBox!.x).toBeGreaterThanOrEqual(textBox!.x - 1);
		expect(dateBox!.x + dateBox!.width).toBeLessThanOrEqual(textBox!.x + textBox!.width + 1);
		const dateOverlapsOpen =
			dateBox!.x < openBox!.x + openBox!.width &&
			dateBox!.x + dateBox!.width > openBox!.x &&
			dateBox!.y < openBox!.y + openBox!.height &&
			dateBox!.y + dateBox!.height > openBox!.y;
		expect(dateOverlapsOpen).toBe(false);
	}
	await expect(side.locator('#relations').getByRole('link', { name: relatedTitle })).toBeVisible();
	await expect(page.locator('.item-detail-main .timeline-bar')).toHaveCount(0);
});

test('item detail columns wrap based on available width, with the side column narrower when both fit', async ({
	page
}) => {
	const itemId = await createTuvItem(page, 'Intrinsic Item Detail Layout Test');

	for (const width of [390, 768, 1024, 1280, 1440, 1920, 2560]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`/items/${itemId}`);
		const layout = await page.evaluate(() => {
			const grid = document.querySelector('.item-detail-layout');
			const main = document.querySelector('.item-detail-main');
			const side = document.querySelector('.item-detail-side');
			if (!grid || !main || !side) return null;
			const gridStyle = getComputedStyle(grid);
			const mainRect = main.getBoundingClientRect();
			const sideRect = side.getBoundingClientRect();
			return {
				availableWidth: grid.getBoundingClientRect().width,
				minimumTwoColumnWidth: 35 * 16 + 18 * 16 + Number.parseFloat(gridStyle.columnGap),
				mainWidth: mainRect.width,
				sideWidth: sideRect.width,
				mainBottom: mainRect.bottom,
				sideTop: sideRect.top
			};
		});
		expect(layout).not.toBeNull();
		const shouldStack = layout!.availableWidth < layout!.minimumTwoColumnWidth;
		expect(layout!.sideTop >= layout!.mainBottom - 1).toBe(shouldStack);
		if (!shouldStack) expect(layout!.mainWidth).toBeGreaterThan(layout!.sideWidth);
		await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
	}
});

test('a long item detail keeps the desktop sidebar at the document bottom', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await createTuvItem(page, 'Redesign Long Detail Test');
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByLabel('Fahrzeug').fill('Example vehicle with a long but realistic title');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

	const layout = await page.evaluate(() => ({
		documentBottom: document.documentElement.scrollHeight,
		viewportHeight: innerHeight,
		sidebarBottom:
			document.querySelector('.app-sidebar')!.getBoundingClientRect().bottom + window.scrollY,
		sidebarPosition: getComputedStyle(document.querySelector('.app-sidebar')!).position
	}));
	expect(layout.documentBottom).toBeGreaterThan(layout.viewportHeight);
	expect(layout.sidebarBottom).toBeGreaterThanOrEqual(layout.documentBottom - 1);
	expect(layout.sidebarPosition).toBe('static');
});

test('detail headings use sentence case and cards have no accented left stripe', async ({
	page
}) => {
	await createTuvItem(page, 'Redesign Label Style Test');
	await page
		.locator('details.fields-panel')
		.filter({ has: page.locator('#fields-label') })
		.locator(':scope > summary')
		.click();
	await page.locator('#next_inspection').fill('2027-02-01');
	await page.locator('#vehicle').fill('Example car');
	await page.getByRole('button', { name: 'Speichern' }).click();

	const labels = page.locator(
		'.item-detail-page .section__label, .item-detail-page .facts-group__label, .item-detail-page .next-up__label, .item-detail-page .fields-panel__title, .item-detail-page .fields-panel__active-label'
	);
	expect(await labels.count()).toBeGreaterThan(0);
	for (const label of await labels.all()) {
		await expect(label).toHaveCSS('text-transform', 'none');
		await expect(label).toHaveCSS('letter-spacing', 'normal');
	}
	for (const card of await page
		.locator(
			'.item-detail-page .next-up, .item-detail-page .facts-group, .item-detail-page .notice'
		)
		.all()) {
		const leftBorder = await card.evaluate((element) => getComputedStyle(element).borderLeftWidth);
		expect(parseFloat(leftBorder)).toBeLessThanOrEqual(1);
	}
});

test('item detail section headings and the final More options section keep shared spacing', async ({
	page
}) => {
	await createTuvItem(page, 'Redesign Section Spacing Test');
	const fieldsPanel = page.locator('details.fields-panel').filter({
		has: page.locator('#fields-label')
	});
	await fieldsPanel.locator(':scope > summary').click();

	// The required token, resolved against this page's own root, not a
	// value this test assumes: a passing comparison against another
	// (possibly also wrong) on-page gap would not catch both being wrong.
	const resolvedSpace3 = await page.evaluate(() => {
		const probe = document.createElement('div');
		probe.style.marginBottom = 'var(--space-3)';
		document.body.append(probe);
		const resolved = parseFloat(getComputedStyle(probe).marginBottom);
		probe.remove();
		return resolved;
	});

	const headingGap = await page
		.locator('#workflow-label')
		.evaluate((node) => parseFloat(getComputedStyle(node).marginBottom));
	const fieldsSummary = fieldsPanel.locator(':scope > summary');
	const fieldsForm = fieldsPanel.locator('.form-panel');
	const summaryBox = await fieldsSummary.boundingBox();
	const formBox = await fieldsForm.boundingBox();
	expect(summaryBox).not.toBeNull();
	expect(formBox).not.toBeNull();
	const fieldsGap = formBox!.y - (summaryBox!.y + summaryBox!.height);
	const moreSection = page.locator('#more-label').locator('..');
	const fieldsSection = fieldsPanel.locator('..');
	const fieldsSectionBox = await fieldsSection.boundingBox();
	const moreBox = await moreSection.boundingBox();
	expect(fieldsSectionBox).not.toBeNull();
	expect(moreBox).not.toBeNull();
	const moreTopGap = moreBox!.y - (fieldsSectionBox!.y + fieldsSectionBox!.height);
	const sectionGap = await page
		.locator('#workflow-label')
		.locator('..')
		.evaluate((node) => parseFloat(getComputedStyle(node).marginBottom));

	// Heading-to-content gap: resolved against the actual --space-3 token.
	expect(headingGap).toBeCloseTo(resolvedSpace3, 0);
	expect(fieldsGap).toBeCloseTo(resolvedSpace3, 0);
	// Section-to-section gap: its own consistent (larger) token, unrelated
	// to the heading-to-content spacing above.
	expect(moreTopGap).toBeCloseTo(sectionGap, 0);
});

test('More options cards match the item detail facts-card width at wide desktop sizes', async ({
	page
}) => {
	await createTuvItem(page, 'Redesign More Options Width Test');
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	const factsCard = page.locator('.facts-group').first();
	const moreCards = page.locator('#more-label').locator('..').locator('.disclosure');
	await expect(factsCard).toBeVisible();
	await expect(moreCards).toHaveCount(2);

	for (const width of [1280, 1920]) {
		await page.setViewportSize({ width, height: 900 });
		const factsBox = await factsCard.boundingBox();
		expect(factsBox).not.toBeNull();

		for (const card of await moreCards.all()) {
			const cardBox = await card.boundingBox();
			expect(cardBox).not.toBeNull();
			expect(cardBox!.x).toBeCloseTo(factsBox!.x, 0);
			expect(cardBox!.x + cardBox!.width).toBeCloseTo(factsBox!.x + factsBox!.width, 0);
		}
	}
});

async function resolvedSpace3(page: import('@playwright/test').Page): Promise<number> {
	return page.evaluate(() => {
		const probe = document.createElement('div');
		probe.style.marginBottom = 'var(--space-3)';
		document.body.append(probe);
		const resolved = parseFloat(getComputedStyle(probe).marginBottom);
		probe.remove();
		return resolved;
	});
}

async function assertClosedFieldsGap(
	page: import('@playwright/test').Page,
	itemUrl: string
): Promise<void> {
	await page.goto(itemUrl);
	const fieldsPanel = page.locator('details.fields-panel').filter({
		has: page.locator('#fields-label')
	});
	await expect(fieldsPanel).not.toHaveAttribute('open', '');
	const summaryBox = await fieldsPanel.locator(':scope > summary').boundingBox();
	const factsBox = await page.locator('div.fields-view').boundingBox();
	expect(summaryBox).not.toBeNull();
	expect(factsBox).not.toBeNull();
	const gap = factsBox!.y - (summaryBox!.y + summaryBox!.height);
	expect(gap).toBeCloseTo(await resolvedSpace3(page), 0);
}

test('the closed fields disclosure keeps a single --space-3 gap to the populated read-only facts view, at mobile and desktop widths', async ({
	page
}) => {
	await createTuvItem(page, 'Redesign Closed Fields Gap Test');
	const itemUrl = page.url();
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.locator('div.fields-view')).toContainText('1. Januar 2026');

	await page.setViewportSize({ width: 1280, height: 900 });
	await assertClosedFieldsGap(page, itemUrl);

	await page.setViewportSize({ width: 390, height: 844 });
	await assertClosedFieldsGap(page, itemUrl);
});

test('mobile stacked columns keep the shared gap between facts and documents', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await createTuvItem(page, 'Redesign Mobile Column Spacing Test');
	const fieldsPanel = page.locator('details.fields-panel').filter({
		has: page.locator('#fields-label')
	});
	if (!(await fieldsPanel.evaluate((node) => node instanceof HTMLDetailsElement && node.open))) {
		await fieldsPanel.locator(':scope > summary').click();
	}
	await page.locator('#next_inspection').fill('2027-02-01');
	await page.locator('#vehicle').fill('Family car');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.locator('#note-label')).toHaveCount(0);

	const mainSection = page.locator('.item-detail-main > .section').last();
	const documentSection = page.locator('.item-detail-side > .section').first();
	const expectedGap = await page
		.locator('#workflow-label')
		.locator('..')
		.evaluate((node) => parseFloat(getComputedStyle(node).marginBottom));
	for (const width of [390, 767]) {
		await page.setViewportSize({ width, height: 844 });
		await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
		const mainBox = await mainSection.boundingBox();
		const documentBox = await documentSection.boundingBox();
		expect(mainBox).not.toBeNull();
		expect(documentBox).not.toBeNull();
		const actualGap = documentBox!.y - (mainBox!.y + mainBox!.height);
		expect(actualGap).toBeCloseTo(expectedGap, 0);
	}
});

test('at 375px, no horizontal overflow and the sticky bar does not cover the fields form', async ({
	page
}) => {
	await page.setViewportSize({ width: 375, height: 667 });
	const title =
		'Redesign Mobile Overflow Test with a Long Vehicle Description and Inspection History';
	await createTuvItem(page, title);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
	await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375);

	// The sticky bar only renders once there is a next action.
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375);
	for (const control of await page
		.locator('.item-detail-page button:visible, .item-detail-page summary:visible')
		.all()) {
		const box = await control.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.height).toBeGreaterThanOrEqual(44);
	}

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	const saveButton = page.getByRole('button', { name: 'Speichern' });
	await saveButton.scrollIntoViewIfNeeded();
	const stickyBar = page.locator('.sticky-action-bar');
	const saveBox = await saveButton.boundingBox();
	const stickyBox = await stickyBar.boundingBox();
	expect(saveBox).not.toBeNull();
	expect(stickyBox).not.toBeNull();
	expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(stickyBox!.y);
});
