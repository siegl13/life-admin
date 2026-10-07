import { expect, type Locator, test } from '@playwright/test';

/**
 * The due dialog repeats the effective date as "Aktuell: …" (and often
 * "Vorgeschlagen: …" too), so a plain `step.getByText(date)` is ambiguous
 * once that dialog exists in the DOM. Scope to the main view's own meta
 * line — a direct child of `.timeline__body`, never nested inside the
 * dialog — to keep asserting the one line this suite always meant.
 */
function dueMeta(step: Locator, date: string) {
	return step.locator('.timeline__body > .meta', { hasText: date });
}

/**
 * "The playbook calculates the default. The user has the final say."
 * A DERIVED action's due date can be overridden, survives a recalculation
 * of the underlying field, and can be reset back to the latest
 * calculated suggestion. Uses the bundled TÜV playbook: `next_inspection`
 * (date field) -> `inspection_due` (event) -> `plan_inspection`
 * (action, offset -1 month).
 */
test('overriding a derived action due date survives a field recalculation and can be reset', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('TÜV Termin Override Test');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	// Scoped by the step's own title (not `.timeline__step`'s full text):
	// once "Fahrzeug / Unterlagen vorbereiten" is blocked on this action, its own
	// "Wartet auf „HU-Termin planen“" text would otherwise make a plain
	// hasText match ambiguous.
	const step = page.locator('.timeline__step').filter({
		has: page.locator('.timeline__title', { hasText: 'HU-Termin planen' })
	});
	await expect(page.locator('.next-up__state')).toContainText('1. Dezember 2025'); // featured date appears once in the hero

	// Override the due date.
	await page.locator('.next-up').getByRole('button', { name: 'Termin ändern' }).click();
	await step.locator('input[name="dueDate"]').fill('2026-01-15');
	await step.getByRole('button', { name: 'Termin speichern' }).click();
	await expect(page).toHaveURL(itemUrl);

	await expect(page.locator('.next-up__state')).toContainText('15. Januar 2026');
	await expect(step.getByText('Eigener Termin')).toBeVisible();
	await expect(step.getByText('Vorschlag: 1. Dezember 2025')).toBeVisible();

	// Change the source field: the suggestion recalculates, but the
	// override must keep winning as the effective due date. Scope to the
	// field's own id because the action also has a date input higher up.
	await page.goto(itemUrl);
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('#next_inspection').fill('2026-02-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	await expect(page.locator('.next-up__state')).toContainText('15. Januar 2026'); // override still effective
	await expect(step.getByText('Vorschlag: 1. Januar 2026')).toBeVisible(); // new suggestion shown

	// Reset to the (now-current) suggestion.
	await step.getByRole('button', { name: 'Auf Vorschlag zurücksetzen' }).click();
	await expect(page).toHaveURL(itemUrl);

	await expect(page.locator('.next-up__state')).toContainText('1. Januar 2026');
	await expect(step.getByText('Eigener Termin')).toHaveCount(0);
});

/**
 * "Termin ändern" must not be limited to the currently-available action:
 * a future DERIVED step blocked only on an earlier dependency (not on its
 * own unresolved date) already has a resolved calculated suggestion the
 * user may want to adjust ahead of time. `prepare_vehicle` derives from
 * the same `inspection_due` event as `plan_inspection`, so both resolve
 * together, but the second stays "Wartet" until the first is done.
 */
test('a future DERIVED action blocked only by a dependency can still have its due date changed', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('TÜV Future Action Override Test');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	const futureStep = page.locator('.timeline__step').filter({
		has: page.locator('.timeline__title', { hasText: 'Fahrzeug / Unterlagen vorbereiten' })
	});
	// Blocked by the dependency, not by an unresolved date of its own —
	// its calculated suggestion is already known.
	await expect(futureStep.getByText('Wartet auf „HU-Termin planen“')).toBeVisible();
	await expect(dueMeta(futureStep, '18. Dezember 2025')).toBeVisible();

	await futureStep.getByRole('button', { name: 'Termin ändern' }).click();
	await futureStep.locator('input[type="date"]').fill('2026-01-20');
	await futureStep.getByRole('button', { name: 'Termin speichern' }).click();

	await expect(dueMeta(futureStep, '20. Januar 2026')).toBeVisible();
	await expect(futureStep.getByText('Eigener Termin')).toBeVisible();
	// Still blocked: an override never changes availability.
	await expect(futureStep.getByText('Wartet auf „HU-Termin planen“')).toBeVisible();
	await expect(futureStep.getByRole('button', { name: 'Erledigen' })).toHaveCount(0);
});

test('an archived item cannot have its due-date override changed or reset via a crafted POST', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('TÜV Termin Override Archived Test');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	const actionId = await page
		.locator('.timeline__step', { hasText: 'HU-Termin planen' })
		.locator('input[name="actionId"]')
		.first()
		.getAttribute('value');
	expect(actionId).toBeTruthy();

	// "Termin ändern" is gone once archived.
	await page.locator('summary', { hasText: 'Archivieren' }).click();
	await page
		.locator('form[action="?/archiveItem"]')
		.getByRole('button', { name: 'Archivieren' })
		.click();
	await expect(
		page
			.locator('.timeline__step', { hasText: 'HU-Termin planen' })
			.getByRole('button', { name: 'Termin ändern' })
	).toHaveCount(0);

	const response = await page.request.post(`${itemUrl}?/setActionDueOverride`, {
		form: { actionId: actionId!, dueDate: '2026-06-01' },
		headers: { accept: 'text/html', origin: 'http://127.0.0.1:4173' }
	});
	expect(response.status()).toBe(400);
});
