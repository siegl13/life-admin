import { expect, test } from '@playwright/test';

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

test('AI extraction: disabled by default, full review/apply/dismiss flow, then disabled again', async ({
	page
}) => {
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
		.setInputFiles({ name: 'pruefbericht.pdf', mimeType: 'application/pdf', buffer: MINIMAL_PDF });
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
	await page.getByRole('link', { name: 'pruefbericht.pdf' }).click();
	await page.getByRole('button', { name: 'Informationen erkennen' }).click();
	await expect(page).toHaveURL(/\/suggestions\//);

	// 6/7/8. Review page: the source document is named, the real field's
	// suggestion is visible, the injected junk is absent, and the
	// discarded count is shown.
	await expect(page.getByText('pruefbericht.pdf')).toBeVisible();
	const nextInspectionSuggestion = page.locator('#suggestion-next_inspection');
	await expect(nextInspectionSuggestion.getByText('Nächste HU')).toBeVisible();
	await expect(nextInspectionSuggestion.getByText('noch leer')).toBeVisible();
	await expect(nextInspectionSuggestion.getByText('15. März 2031')).toBeVisible();
	await expect(page.getByText('unknown_field_from_model')).toHaveCount(0);
	await expect(page.getByText('Vorschläge wurden verworfen')).toBeVisible();

	// 10/11. Apply the (pre-checked, since the field was empty) suggestion.
	// Anchored by the field's own id (not `.first()`): once the field is
	// filled, the now-resolved derived action gains its own due-date
	// override date input earlier in the DOM (see WorkflowTimeline.svelte).
	await page.getByRole('button', { name: 'Ausgewählte übernehmen' }).click();
	await expect(page).toHaveURL(itemUrl);
	await expect(page.locator('#field-next_inspection input[type="date"]')).toHaveValue('2031-03-15');
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

	await page.getByRole('link', { name: 'pruefbericht.pdf' }).click();
	await page.getByRole('button', { name: 'Informationen erkennen' }).click();
	await expect(page).toHaveURL(/\/suggestions\//);
	await expect(page.getByText('Aktueller Wert')).toBeVisible();
	await expect(page.getByText('1. Januar 2030')).toBeVisible();
	await expect(page.getByText('Überschreibt den aktuellen Wert')).toBeVisible();
	await expect(page.getByRole('checkbox').first()).not.toBeChecked();

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
	await expect(additional.getByText('Zusätzliche Information')).toBeVisible();
	await expect(additional.getByText('Weiterer Termin')).toBeVisible();
	await expect(additional.getByText('Monatliche Rate')).toBeVisible();
	await expect(additional.getByText('351,00 €')).toBeVisible();
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
	await infoRow.getByLabel('Bezeichnung').fill('Vertragsende');
	await infoRow.getByLabel('Typ').selectOption('date');
	await expect(infoRow.getByLabel('Wert')).toHaveAttribute('type', 'date');
	await infoRow.getByLabel('Wert').fill('2032-04-05');

	// Select the currency suggestion, rename it, and add it.
	const rateRow = additional.locator('.additional-suggestion', { hasText: 'Monatliche Rate' });
	await rateRow.getByRole('checkbox').check();
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

	await page.goto('/settings');
	await page.getByRole('button', { name: 'Ausschalten' }).click();
});
