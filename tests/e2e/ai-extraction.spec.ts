import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The deterministic fake provider (LIFEADMIN_AI_FAKE=1, no real key,
 * see playwright.config.ts) returns a fixed date for every date field
 * plus two suggestions that must be discarded: an unknown field key and
 * an unknown date-like field key with a non-ISO value (see
 * src/lib/server/ai/fakeProvider.ts). No document ever leaves this
 * machine and no network I/O occurs.
 *
 * Scoped to its own item (a TÜV item, since the e2e database persists
 * across every spec in the run). Enables AI at the start and disables it
 * again at the end so later specs see the same off-by-default state a
 * fresh install would.
 */
const MINIMAL_PDF = Buffer.from('%PDF-1.4\n%%EOF');

test.afterEach(async ({ page }) => {
	await page.goto('/settings');
	const disable = page.getByRole('button', { name: 'Ausschalten', exact: true });
	if (await disable.count()) await disable.click();
});

async function createTuvItemWithAttachment(
	page: Page,
	title: string,
	filename: string,
	initialDate?: string
) {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();
	if (initialDate) {
		await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
		await page.locator('#field-next_inspection input[type="date"]').fill(initialDate);
		await page.getByRole('button', { name: 'Speichern' }).click();
		await expect(page).toHaveURL(itemUrl);
	}
	const attachmentForm = page.locator('form[action="?/addAttachment"]');
	await attachmentForm.locator('input[type="file"]').setInputFiles({
		name: filename,
		mimeType: 'application/pdf',
		buffer: MINIMAL_PDF
	});
	await attachmentForm.getByRole('button', { name: 'Hinzufügen' }).click();
	return itemUrl;
}

async function openExtractionReview(page: Page, filename: string) {
	await page.getByRole('link', { name: filename }).click();
	await page.getByRole('button', { name: 'Informationen erkennen' }).click();
	await expect(page).toHaveURL(/\/suggestions\//);
	await expect(page.locator('.app-fab')).toHaveCount(0);
}

test('AI extraction: disabled by default, full review/apply/dismiss flow, then disabled again', async ({
	page
}) => {
	const documentName = 'a'.repeat(196) + '.pdf';
	// 1. AI disabled by default: create the item and confirm no button exists.
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('KFZ AI-Test');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();

	// "Dokumente verwalten" defaults open with zero attachments yet.
	await page
		.locator('form[action="?/addAttachment"]')
		.locator('input[type="file"]')
		.setInputFiles({ name: documentName, mimeType: 'application/pdf', buffer: MINIMAL_PDF });
	await page
		.locator('form[action="?/addAttachment"]')
		.getByRole('button', { name: 'Hinzufügen' })
		.click();
	await expect(page.getByRole('button', { name: 'Informationen erkennen' })).toHaveCount(0);

	// 2. Enable AI with explicit consent. (Server-side enforcement of the
	// consent checkbox itself is covered by aiSettings.test.ts —
	// AiConsentRequiredError — since the checkbox's `required` attribute
	// blocks an unchecked submit natively before it ever reaches the
	// server in a real browser.)
	await page.goto('/settings');
	await page.getByLabel('Ich habe verstanden, dass ausgewählte Dokumente an OpenAI').check();
	await page.getByRole('button', { name: 'Einschalten' }).click();
	// Exact match: without it, this also matches the "Ausnahme: Die
	// Dokumenterkennung ist eingeschaltet…" privacy-note sentence that
	// appears on the same page once AI is on.
	await expect(page.getByText('Eingeschaltet', { exact: true })).toBeVisible();

	// 3/4/5. Run extraction on the uploaded document.
	await page.goto(itemUrl);
	await page.getByRole('link', { name: documentName, exact: true }).click();
	await page.getByRole('button', { name: 'Informationen erkennen' }).click();
	await expect(page).toHaveURL(/\/suggestions\//);

	// 6/7/8. Review page: the source document is named, the real field's
	// suggestion is visible, the injected junk is absent, and the
	// discarded count is shown.
	await expect(page.getByText(`Erkannt aus: ${documentName}`, { exact: true })).toBeVisible();
	const nextInspectionSuggestion = page.locator('#suggestion-next_inspection');
	await expect(nextInspectionSuggestion.getByText('Nächste HU')).toBeVisible();
	await expect(nextInspectionSuggestion.getByText('noch leer')).toBeVisible();
	await expect(nextInspectionSuggestion.getByText('15. März 2031')).toBeVisible();
	await expect(page.getByText('unknown_field_from_model')).toHaveCount(0);
	await expect(page.getByText('Vorschläge wurden verworfen')).toBeVisible();

	// 10/11. Apply the (pre-checked, since the field was empty) suggestion.
	// Keep only this suggestion selected so the real accepted-history event
	// covers the singular count. Anchored by the field's own id (not `.first()`):
	// once filled, the resolved action gains its own date input earlier in the
	// DOM (see WorkflowTimeline.svelte).
	for (const checkbox of await page.locator('#known-suggestions input[type="checkbox"]').all()) {
		if (!(await checkbox.isChecked())) continue;
		if ((await checkbox.getAttribute('name')) !== 'accept:next_inspection')
			await checkbox.uncheck();
	}
	await page.getByRole('button', { name: 'Ausgewählte übernehmen' }).click();
	await expect(page).toHaveURL(itemUrl);
	await expect(page.locator('#field-next_inspection input[type="date"]')).toHaveValue('2031-03-15');
	const acceptedHistory = page.locator('.history-event__text').filter({
		hasText: `1 Vorschlag aus „${documentName}“ übernommen`
	});
	await expect(acceptedHistory).toHaveText(`1 Vorschlag aus „${documentName}“ übernommen`);
	for (const width of [375, 390, 430, 1280]) {
		await page.setViewportSize({ width, height: 800 });
		await expect(acceptedHistory).toBeVisible();
		await expect
			.poll(async () =>
				acceptedHistory.evaluate((text) => {
					const bounds = text.getBoundingClientRect();
					const row = text.closest('.history-event')!.getBoundingClientRect();
					return (
						text.scrollWidth <= text.clientWidth &&
						bounds.left >= row.left &&
						bounds.right <= row.right + 1 &&
						document.documentElement.scrollWidth <= window.innerWidth
					);
				})
			)
			.toBe(true);
	}
	// .first(): the resolved action now legitimately appears in both the
	// workflow timeline and the "Nächste Schritte" widget.
	await expect(page.getByText('HU-Termin planen').first()).toBeVisible();

	// 12. Change the field to a value different from what the fake provider
	// always suggests, then run extraction again: the suggestion now
	// disagrees with the current value, so the review page must show the
	// overwrite warning and leave the checkbox unchecked by default (AC6 —
	// a filled field is never pre-checked). The fake provider filled every
	// playbook field, so "Angaben" is now in read-only mode. Open editing first.
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('#field-next_inspection input[type="date"]').fill('2030-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page).toHaveURL(itemUrl);
	await expect(page.locator('#field-next_inspection input[type="date"]')).toHaveValue('2030-01-01');

	await page.getByRole('link', { name: documentName, exact: true }).click();
	await page.getByRole('button', { name: 'Informationen erkennen' }).click();
	await expect(page).toHaveURL(/\/suggestions\//);
	const inspectionSuggestion = page.locator('#suggestion-next_inspection');
	await expect(inspectionSuggestion.getByText('Aktueller Wert: 1. Januar 2030')).toBeVisible();
	await expect(inspectionSuggestion.getByText('Wert im Dokument: 15. März 2031')).toBeVisible();
	await expect(inspectionSuggestion.getByLabel('Aktuellen Wert behalten')).toBeChecked();
	await expect(
		inspectionSuggestion.getByLabel('Wert aus dem Dokument verwenden')
	).not.toBeChecked();

	// 13/14. Dismiss: no field change.
	await page.getByRole('button', { name: 'Verwerfen' }).click();
	await expect(page).toHaveURL(itemUrl);
	await expect(page.locator('#field-next_inspection input[type="date"]')).toHaveValue('2030-01-01');

	// 15. Disable AI: button disappears again.
	await page.goto('/settings');
	await page.getByRole('button', { name: 'Ausschalten' }).click();
	await expect(page.locator('#g-ai').getByText('Ausgeschaltet', { exact: true })).toBeVisible();
	await page.goto(itemUrl);
	await expect(page.getByRole('button', { name: 'Informationen erkennen' })).toHaveCount(0);
});

/**
 * AI Extraction 1.1: the fake provider's fixed "additional suggestions"
 * mix (one text, one date, one currency, plus one that duplicates an
 * existing field's label — see fakeProvider.ts) exercises the whole new
 * flow: known vs. additional suggestions shown separately, the obvious
 * duplicate silently absent, client-side search, changing and renaming a
 * suggestion before adding it, and accepted suggestions becoming ordinary,
 * manageable Custom Field. Scoped to its own item; enables/disables AI
 * itself since it may run before or after the spec above.
 */
test('AI Extraction 1.1: additional suggestions are searchable and become normal Custom Fields', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('KFZ AI-Additional-Test');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();

	// "Dokumente verwalten" defaults open with zero attachments yet.
	await page
		.locator('form[action="?/addAttachment"]')
		.locator('input[type="file"]')
		.setInputFiles({ name: 'pruefbericht.pdf', mimeType: 'application/pdf', buffer: MINIMAL_PDF });
	await page
		.locator('form[action="?/addAttachment"]')
		.getByRole('button', { name: 'Hinzufügen' })
		.click();

	await page.goto('/settings');
	await page.getByLabel('Ich habe verstanden, dass ausgewählte Dokumente an OpenAI').check();
	await page.getByRole('button', { name: 'Einschalten' }).click();

	await page.goto(itemUrl);
	await page.getByRole('link', { name: 'pruefbericht.pdf' }).click();
	await page.getByRole('button', { name: 'Informationen erkennen' }).click();
	await expect(page).toHaveURL(/\/suggestions\//);

	const additional = page.locator('#additional-suggestions');
	await expect(
		additional.locator('.additional-suggestion').filter({ hasText: 'Zusätzliche Information' })
	).toBeVisible();
	await expect(additional.getByText('Weiterer Termin')).toBeVisible();
	await expect(additional.getByText('Monatliche Rate')).toBeVisible();
	await expect(additional.getByText('351,00 €')).toBeVisible();
	await expect(additional.getByText('Quelle:', { exact: true }).first()).toBeVisible();
	await expect(
		additional.locator('.additional-suggestion__evidence q', {
			hasText: 'Zusätzliche Information: Randnotiz aus dem Dokument'
		})
	).toBeVisible();
	const visualEvidence = path.resolve('.agent/supervisor/group-assignment-final/visual');
	fs.mkdirSync(visualEvidence, { recursive: true });
	for (const width of [375, 390, 430]) {
		await page.setViewportSize({ width, height: 900 });
		await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
		await page.screenshot({ path: path.join(visualEvidence, `suggestions-${width}.png`) });
		await additional.scrollIntoViewIfNeeded();
		await page.screenshot({ path: path.join(visualEvidence, `additional-fields-${width}.png`) });
	}
	await page.evaluate(() => window.scrollTo(0, 0));
	// The 4th fixed suggestion duplicates the known field's own label —
	// server-side dedup (filterAdditionalSuggestions) must have discarded
	// it before it ever reached this page.
	await expect(additional.getByText('Doppelte zusätzliche Information')).toHaveCount(0);

	// Client-side search: only the matching row stays.
	await page.getByLabel('Angaben durchsuchen').fill('Rate');
	await expect(additional.getByText('Monatliche Rate')).toBeVisible();
	await expect(additional.getByText('Zusätzliche Information')).toHaveCount(0);
	await expect(additional.getByText('Weiterer Termin')).toHaveCount(0);
	await page.getByLabel('Angaben durchsuchen').fill('');

	// Override a text suggestion with a date before applying it. This keeps
	// the select and its matching value control reactive without changing
	// the original suggestion payload.
	const infoRow = additional.locator('.additional-suggestion', {
		hasText: 'Zusätzliche Information'
	});
	await infoRow.getByRole('checkbox').check();
	await infoRow.locator('details > summary').click();
	await infoRow.getByLabel('Bezeichnung').fill('Vertragsende');
	await infoRow.getByLabel('Typ').selectOption('date');
	await expect(infoRow.getByLabel('Wert')).toHaveAttribute('type', 'date');
	await infoRow.getByLabel('Wert').fill('2032-04-05');
	await expect(
		infoRow.getByRole('combobox', { name: 'Gruppe' }).locator('option:checked')
	).toHaveText('Allgemein');
	await infoRow.getByRole('combobox', { name: 'Gruppe' }).selectOption({ label: 'Fahrzeug' });

	// Select the currency suggestion, rename it, and add it.
	const rateRow = additional.locator('.additional-suggestion', { hasText: 'Monatliche Rate' });
	await rateRow.getByRole('checkbox').check();
	await rateRow.locator('details > summary').click();
	await rateRow.getByLabel('Bezeichnung').fill('Leasingrate');
	await additional.getByRole('button', { name: 'Ausgewählte hinzufügen' }).click();

	// One form for both sections now (see the `apply` action): submitting
	// either button applies everything checked in BOTH sections at once —
	// not just its own. The known `next_inspection` suggestion was still
	// pre-checked (its field was empty), so clicking only the additional
	// section's button must also have applied it, alongside creating
	// "Leasingrate". That fills every field, so "Angaben" now defaults to
	// its closed, read-only Normal view instead of the open Manage one.
	await expect(page).toHaveURL(itemUrl);
	const fieldsView = page.locator('.fields-view');
	await expect(fieldsView.locator('.data-row', { hasText: 'Nächste HU' })).toContainText(
		'15. März 2031'
	);
	await expect(fieldsView.locator('.data-row', { hasText: 'Leasingrate' })).toContainText('351,00');
	await expect(fieldsView.locator('.data-row', { hasText: 'Vertragsende' })).toContainText(
		'5. April 2032'
	);
	const vehicleGroup = page.locator('.facts-group').filter({
		has: page.locator('.facts-group__label', { hasText: 'Fahrzeug' })
	});
	await expect(vehicleGroup.locator('.data-row__key', { hasText: 'Vertragsende' })).toHaveCount(1);
	await page.reload();
	const persistedVehicleGroup = page.locator('.facts-group').filter({
		has: page.locator('.facts-group__label', { hasText: 'Fahrzeug' })
	});
	await expect(
		persistedVehicleGroup.locator('.data-row__key', { hasText: 'Vertragsende' })
	).toHaveCount(1);
	const historyEvents = page.locator('.history-event__text');
	await expect(historyEvents).toHaveCount(3);
	await expect(
		historyEvents.getByText('5 Vorschläge aus „pruefbericht.pdf“ übernommen', { exact: true })
	).toHaveCount(1);
	await expect(
		historyEvents.getByText('2 Vorschläge aus „pruefbericht.pdf“ übernommen', { exact: true })
	).toHaveCount(1);
	await expect(historyEvents.getByText('Dokument hinzugefügt', { exact: true })).toHaveCount(1);
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	const longValue = 'VIN' + '0123456789'.repeat(5);
	await page.locator('#license_plate').fill(longValue);
	await page.getByRole('button', { name: 'Speichern' }).click();
	const textFacts = page.locator('.facts-group').filter({
		has: page.locator('.facts-group__label', { hasText: 'Fahrzeug' })
	});
	const longValueCell = textFacts
		.locator('.data-row', { hasText: longValue })
		.locator('.data-row__value');
	for (const width of [375, 390, 430, 1024]) {
		await page.setViewportSize({ width, height: 800 });
		await expect(longValueCell).toHaveText(longValue);
		await expect(longValueCell).toHaveAttribute('title', longValue);
		await expect(longValueCell).toHaveCSS('white-space', 'nowrap');
		await expect(longValueCell).toHaveCSS('text-overflow', 'ellipsis');
		await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
		const overflow = await page.evaluate(() =>
			Array.from(document.querySelectorAll<HTMLElement>('*'))
				.map((element) => ({
					selector: `${element.tagName.toLowerCase()}.${element.className.toString().replace(/\s+/g, '.')}`,
					left: Math.round(element.getBoundingClientRect().left),
					right: Math.round(element.getBoundingClientRect().right),
					width: Math.round(element.getBoundingClientRect().width)
				}))
				.filter((element) => element.right > innerWidth || element.left < 0)
				.sort((a, b) => b.right - a.right)
		);
		const layout = await longValueCell.evaluate((value) => {
			const chain = [];
			for (
				let element: HTMLElement | null = value as HTMLElement;
				element;
				element = element.parentElement
			) {
				const style = getComputedStyle(element);
				const rect = element.getBoundingClientRect();
				chain.push({
					tag: element.tagName,
					className: element.className,
					width: rect.width,
					maxWidth: style.maxWidth,
					display: style.display,
					flexDirection: style.flexDirection,
					overflowWrap: style.overflowWrap,
					whiteSpace: style.whiteSpace
				});
				if (element.tagName === 'MAIN') break;
			}
			return chain;
		});
		expect(
			overflow.filter((element) => element.right > width),
			JSON.stringify({ overflow, layout })
		).toEqual([]);
	}

	await page.goto('/settings');
	await page.getByRole('button', { name: 'Ausschalten' }).click();
});

test('a document-derived Field can be reassigned without changing its value or extraction history', async ({
	page
}) => {
	const filename = 'gruppenbeleg.pdf';
	const itemUrl = await createTuvItemWithAttachment(
		page,
		'Extracted Field Group assignment',
		filename
	);
	await page.goto('/settings');
	await page.getByLabel('Ich habe verstanden, dass ausgewählte Dokumente an OpenAI').check();
	await page.getByRole('button', { name: 'Einschalten' }).click();

	await page.goto(itemUrl);
	await openExtractionReview(page, filename);
	const additional = page.locator('#additional-suggestions');
	const selectedSuggestion = additional.locator('.additional-suggestion', {
		hasText: 'Zusätzliche Information'
	});
	await selectedSuggestion.getByRole('checkbox').check();
	for (const checkbox of await page.locator('#known-suggestions input[type="checkbox"]').all()) {
		if (await checkbox.isChecked()) await checkbox.uncheck();
	}
	await additional.getByRole('button', { name: 'Ausgewählte hinzufügen' }).click();
	await expect(page).toHaveURL(itemUrl);

	const openGroups = async () => {
		const manager = page.locator('details#field-groups');
		if (!(await manager.evaluate((element) => (element as HTMLDetailsElement).open))) {
			const panel = page
				.locator('details.fields-panel')
				.filter({ has: page.locator('#fields-label') });
			if (!(await panel.evaluate((element) => (element as HTMLDetailsElement).open))) {
				await panel.locator(':scope > summary').click();
			}
			await manager.locator(':scope > summary').click();
		}
		return manager;
	};
	const manager = await openGroups();
	await manager.locator('details.group-add > summary').click();
	await manager.getByLabel('Neue Gruppe').fill('Belege');
	await manager.getByRole('button', { name: 'Gruppe anlegen' }).click();
	const fieldInput = page.getByLabel('Zusätzliche Information', { exact: true });
	const fieldKey = await fieldInput.getAttribute('id');
	expect(fieldKey).toMatch(/^c_/);
	const groupSelect = page.locator(`#group-${fieldKey}`);
	const originalValue = await fieldInput.inputValue();
	expect(originalValue).toBe('Randnotiz aus dem Dokument');
	await groupSelect.selectOption({ label: 'Belege' });
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();

	const targetGroup = page.locator('.facts-group').filter({
		has: page.locator('.facts-group__label', { hasText: 'Belege' })
	});
	await expect(targetGroup.locator('.data-row__key')).toHaveText('Zusätzliche Information');
	await expect(targetGroup.locator('.data-row__value')).toHaveText(originalValue);
	const extractionHistory = page.locator('.history-event__text').filter({
		hasText: `1 Vorschlag aus „${filename}“ übernommen`
	});
	await expect(extractionHistory).toBeVisible();

	await page.reload();
	await expect(targetGroup.locator('.data-row__value')).toHaveText(originalValue);
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await expect(page.locator(`#${fieldKey}`)).toHaveValue(originalValue);
	await expect(page.locator(`#group-${fieldKey} option:checked`)).toHaveText('Belege');
	await expect(page.locator(`#${fieldKey}`)).toHaveAttribute('id', fieldKey!);
	await expect(page.locator('.history-event__text').filter({ hasText: filename })).toBeVisible();

	await page.goto('/settings');
	await page.getByRole('button', { name: 'Ausschalten' }).click();
});

/**
 * Document Action suggestions and safe field comparison, end to end with the
 * deterministic fake provider (see fakeProvider.ts): a deadline, an
 * availability, a relative date and an already-done step. Nothing is created
 * without selection, availability never becomes a due date, a later run
 * offers no duplicate, and a conflicting value is only replaced by an
 * explicit choice.
 */
test('Document actions: explicit selection, dates, no duplicates, safe conflict replace', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('KFZ AI-Aktionen-Test');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();

	await page
		.locator('form[action="?/addAttachment"]')
		.locator('input[type="file"]')
		.setInputFiles({ name: 'pruefbericht.pdf', mimeType: 'application/pdf', buffer: MINIMAL_PDF });
	await page
		.locator('form[action="?/addAttachment"]')
		.getByRole('button', { name: 'Hinzufügen' })
		.click();

	await page.goto('/settings');
	await page.getByLabel('Ich habe verstanden, dass ausgewählte Dokumente an OpenAI').check();
	await page.getByRole('button', { name: 'Einschalten' }).click();

	await page.goto(itemUrl);
	await page.getByRole('link', { name: 'pruefbericht.pdf' }).click();
	await page.getByRole('button', { name: 'Informationen erkennen' }).click();
	await expect(page).toHaveURL(/\/suggestions\//);

	// Mobile first: the whole review fits without horizontal scrolling.
	const actionSuggestions = page.locator('#action-suggestions');
	for (const width of [375, 390, 430]) {
		await page.setViewportSize({ width, height: 800 });
		await expect(actionSuggestions).toBeVisible();
		await expect(page.locator('.app-fab')).toHaveCount(0);
		await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
	}

	// Three open suggestions; the already-done one is discarded. None is
	// selected by default, so nothing would be created by a plain submit.
	await expect(actionSuggestions.getByRole('checkbox')).toHaveCount(3);
	await expect(actionSuggestions.getByRole('checkbox').first()).not.toBeChecked();
	await expect(actionSuggestions.getByText('Bereits erledigter Schritt')).toHaveCount(0);
	await expect(actionSuggestions.getByText('Verfügbar ab 1. April 2031')).toBeVisible();
	// The absolute deadline and the relative one ("2 weeks before Nächste HU",
	// resolved from this document's own value) land on the same date.
	await expect(
		actionSuggestions.locator('[data-action-date-selected]').filter({
			hasText: 'Fällig bis 1. März 2031'
		})
	).toHaveCount(2);
	const relativeActionDate = actionSuggestions
		.getByLabel(/Termin bestätigen/)
		.locator('xpath=..')
		.locator('[data-action-date-selected]');
	await page.locator('#suggestion-next_inspection input[type="checkbox"]').uncheck();
	await expect(relativeActionDate).toContainText('Ohne Datum');
	await page.locator('#suggestion-next_inspection input[type="checkbox"]').check();
	await expect(relativeActionDate).toContainText('Fällig bis 1. März 2031');

	await actionSuggestions.getByLabel('Unterlagen prüfen').check();
	await actionSuggestions.getByLabel('Online-Portal nutzen').check();
	await page.getByRole('button', { name: 'Ausgewählte übernehmen' }).click();
	await expect(page).toHaveURL(itemUrl);

	// Ordinary actions: the deadline is the due date, the availability is
	// only a note and never a due date, the unselected one does not exist.
	const documents = page.locator('.timeline__step', { hasText: 'Unterlagen prüfen' });
	await expect(documents).toContainText('1. März 2031');
	const portal = page.locator('.timeline__step', { hasText: 'Online-Portal nutzen' });
	await expect(portal).toContainText('Verfügbar ab 1. April 2031');
	await expect(portal).not.toContainText('Fällig am');
	await expect(page.getByText('Termin bestätigen')).toHaveCount(0);
	await expect(
		page.locator('.history-event__text', { hasText: 'Aufgabe hinzugefügt' })
	).toHaveCount(2);

	// A second run: the selected actions are not offered again. Change the
	// current field value first so this run also checks the default conflict
	// behavior without spending a separate daily AI attempt.
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('#field-next_inspection input[type="date"]').fill('2030-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page).toHaveURL(itemUrl);

	await page.getByRole('link', { name: 'pruefbericht.pdf' }).click();
	await page.getByRole('button', { name: 'Informationen erkennen' }).click();
	await expect(page).toHaveURL(/\/suggestions\//);
	await expect(page.locator('#action-suggestions').getByRole('checkbox')).toHaveCount(1);
	await expect(page.locator('#action-suggestions').getByText('Termin bestätigen')).toBeVisible();
	await expect(page.locator('#suggestion-next_inspection')).toBeVisible();
	await expect(page.locator('#already-present')).toBeVisible();
	await page.getByRole('button', { name: 'Ausgewählte übernehmen' }).click();
	await expect(page).toHaveURL(itemUrl);
	await expect(page.locator('#field-next_inspection input[type="date"]')).toHaveValue('2030-01-01');

	await page.getByRole('link', { name: 'pruefbericht.pdf' }).click();
	await page.getByRole('button', { name: 'Informationen erkennen' }).click();
	await page
		.locator('#suggestion-next_inspection')
		.getByLabel('Wert aus dem Dokument verwenden')
		.check();
	await expect(relativeActionDate).toContainText('Fällig bis 1. März 2031');
	await page.locator('#action-suggestions').getByLabel('Termin bestätigen').check();
	await page.getByRole('button', { name: 'Ausgewählte übernehmen' }).click();
	await expect(page).toHaveURL(itemUrl);
	await expect(page.locator('#field-next_inspection input[type="date"]')).toHaveValue('2031-03-15');
	const replacedAction = page.locator('.timeline__step', { hasText: 'Termin bestätigen' });
	await expect(replacedAction).toContainText('1. März 2031');

	// On a separate Item, deselect the new anchor and submit Accept all new.
	// Its preview and the saved Action both use the automatically accepted anchor.
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('KFZ AI-Aktionen-ohne-Anker');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const noAnchorItemUrl = page.url();
	await page
		.locator('form[action="?/addAttachment"] input[type="file"]')
		.setInputFiles({ name: 'ohne-anker.pdf', mimeType: 'application/pdf', buffer: MINIMAL_PDF });
	await page
		.locator('form[action="?/addAttachment"]')
		.getByRole('button', { name: 'Hinzufügen' })
		.click();
	await page.getByRole('link', { name: 'ohne-anker.pdf' }).click();
	await page.getByRole('button', { name: 'Informationen erkennen' }).click();
	await expect(page).toHaveURL(/\/suggestions\//);
	const noAnchorDate = page
		.locator('#action-suggestions')
		.getByLabel(/Termin bestätigen/)
		.locator('xpath=..')
		.locator('[data-action-date-selected]');
	await page.locator('#suggestion-next_inspection input[type="checkbox"]').uncheck();
	await expect(noAnchorDate).toContainText('Ohne Datum');
	const noAnchorAcceptAllDate = page
		.locator('#action-suggestions')
		.getByLabel(/Termin bestätigen/)
		.locator('xpath=../..')
		.locator('[data-action-date-accept-all]');
	await expect(noAnchorAcceptAllDate).toContainText('Fällig bis 1. März 2031');
	await page.locator('#action-suggestions').getByLabel('Termin bestätigen').check();
	await page.getByRole('button', { name: 'Alle neuen übernehmen' }).click();
	await expect(page).toHaveURL(noAnchorItemUrl);
	const acceptedAllAction = page.locator('.timeline__step', { hasText: 'Termin bestätigen' });
	await expect(acceptedAllAction).toBeVisible();
	await expect(acceptedAllAction).toContainText('1. März 2031');

	// Accept-all ignores explicit replacements, so its preview remains based on
	// the current anchor and the created Action must use that same date.
	const acceptAllConflictUrl = await createTuvItemWithAttachment(
		page,
		'KFZ AI-Aktionen-Alle-neuen-Konflikt',
		'alle-neuen-konflikt.pdf',
		'2030-01-01'
	);
	await openExtractionReview(page, 'alle-neuen-konflikt.pdf');
	await page
		.locator('#suggestion-next_inspection')
		.getByLabel('Wert aus dem Dokument verwenden')
		.check();
	const conflictAction = page
		.locator('#action-suggestions')
		.getByLabel(/Termin bestätigen/)
		.locator('xpath=../..');
	await expect(conflictAction.locator('[data-action-date-selected]')).toContainText('1. März 2031');
	await expect(conflictAction.locator('[data-action-date-accept-all]')).toContainText(
		'18. Dezember 2029'
	);
	await page.locator('#action-suggestions').getByLabel('Termin bestätigen').check();
	await page.getByRole('button', { name: 'Alle neuen übernehmen' }).click();
	await expect(page).toHaveURL(acceptAllConflictUrl);
	await expect(page.locator('#field-next_inspection input[type="date"]')).toHaveValue('2030-01-01');
	await expect(page.locator('.timeline__step', { hasText: 'Termin bestätigen' })).toContainText(
		'18. Dezember 2029'
	);

	await page.goto('/settings');
	await page.getByRole('button', { name: 'Ausschalten' }).click();
});
