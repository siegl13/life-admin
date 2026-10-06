import { expect, test } from '@playwright/test';

/**
 * Compact Action-detail UX: primary Mark done/Skip stay directly
 * accessible, secondary snooze/due editors live in one native <dialog>
 * each (hidden until its compact trigger row is opened, closable with
 * Escape or a backdrop tap), and a rejected submission reopens its own
 * dialog with the entered value instead of silently discarding it. See
 * WorkflowTimeline.svelte.
 */

const dateFormat = new Intl.DateTimeFormat('de-DE', {
	day: 'numeric',
	month: 'long',
	year: 'numeric',
	timeZone: 'UTC'
});

function isoDaysFromToday(days: number): string {
	const d = new Date();
	d.setUTCHours(0, 0, 0, 0);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

function formattedDaysFromToday(days: number): string {
	const [year, month, day] = isoDaysFromToday(days).split('-').map(Number);
	return dateFormat.format(new Date(Date.UTC(year, month - 1, day)));
}

test('mobile: due dialog stays collapsed for an eligible derived action, opens with Current/Suggested context, and closes with Escape', async ({
	page
}) => {
	await page.setViewportSize({ width: 375, height: 667 });
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Compact UX Mobile Test');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	const step = page.locator('.timeline__step').filter({
		has: page.locator('.timeline__title', { hasText: 'HU-Termin planen' })
	});

	// Primary actions need no dialog opened first.
	const markDone = step.getByRole('button', { name: 'Erledigen' });
	await expect(markDone).toBeVisible();
	await expect(step.getByRole('button', { name: 'Überspringen' })).toBeVisible();

	// Readiness renders right under the title/due status, not after the
	// controls — the mobile single-column layout must not push it below
	// the primary/secondary rows.
	const readiness = step.locator('.timeline__status-inline');
	await expect(readiness).toBeVisible();
	await expect(readiness).toHaveText('Jetzt möglich');
	const readinessBox = await readiness.boundingBox();
	const markDoneBox = await markDone.boundingBox();
	expect(readinessBox).not.toBeNull();
	expect(markDoneBox).not.toBeNull();
	expect(readinessBox!.y).toBeLessThan(markDoneBox!.y);

	// The due editor's compact trigger is visible; its dialog is not.
	const dueTrigger = step.getByRole('button', { name: 'Termin ändern' });
	await expect(dueTrigger).toBeVisible();
	const dueDialog = step.locator('dialog.action-dialog').first();
	await expect(dueDialog).not.toBeVisible();

	await dueTrigger.click();
	await expect(dueDialog).toBeVisible();
	// -1 month, calculated suggestion: current and suggested agree since no
	// override has been set yet.
	await expect(dueDialog.getByText('Aktuell: 1. Dezember 2025')).toBeVisible();
	await expect(dueDialog.getByText('Vorgeschlagen: 1. Dezember 2025')).toBeVisible();

	// Escape dismisses the native dialog (built-in cancel behaviour).
	await page.keyboard.press('Escape');
	await expect(dueDialog).not.toBeVisible();

	// Remind me later stays collapsed the same way.
	const remindTrigger = step.getByRole('button', { name: 'Später erinnern' });
	await expect(remindTrigger).toBeVisible();
	await expect(step.getByRole('button', { name: 'Morgen' })).toHaveCount(0);
	await remindTrigger.click();
	await expect(step.getByRole('button', { name: 'Morgen' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(step.getByRole('button', { name: 'Morgen' })).toHaveCount(0);

	await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375);
});

test('each snooze choice produces its exact expected date, and the dialog collapses again after success', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Snooze Exact Dates Test');
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
	const addAction = page.locator('form[action="?/addManualAction"]');
	await addAction.getByLabel('Bezeichnung der Aufgabe').fill('Snooze exact dates task');
	await addAction.getByLabel('Fällig am (optional)').fill('2099-01-01');
	await addAction.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();

	const step = page.locator('.timeline__step', { hasText: 'Snooze exact dates task' });

	await step.getByRole('button', { name: 'Später erinnern' }).click();
	await step.getByRole('button', { name: 'Morgen' }).click();
	await expect(step.getByText(`Erneut erinnern am ${formattedDaysFromToday(1)}`)).toBeVisible();
	// Successful submit closed the dialog again (full-page redirect).
	await expect(step.getByRole('button', { name: 'Morgen' })).toHaveCount(0);

	await step.getByRole('button', { name: 'Erinnerungsdatum ändern' }).click();
	await step.getByRole('button', { name: 'In 3 Tagen' }).click();
	await expect(step.getByText(`Erneut erinnern am ${formattedDaysFromToday(3)}`)).toBeVisible();

	await step.getByRole('button', { name: 'Erinnerungsdatum ändern' }).click();
	await step.getByRole('button', { name: 'In 7 Tagen' }).click();
	await expect(step.getByText(`Erneut erinnern am ${formattedDaysFromToday(7)}`)).toBeVisible();

	await step.getByRole('button', { name: 'Erinnerungsdatum ändern' }).click();
	const customIso = isoDaysFromToday(30);
	await step.getByLabel('Anderes Datum').fill(customIso);
	await step.getByRole('button', { name: 'Setzen' }).click();
	await expect(step.getByText(`Erneut erinnern am ${formattedDaysFromToday(30)}`)).toBeVisible();
});

test('a rejected custom snooze date reopens the dialog with the entered value and the error visible', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Snooze Rejected Test');
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
	const addAction = page.locator('form[action="?/addManualAction"]');
	await addAction.getByLabel('Bezeichnung der Aufgabe').fill('Snooze rejected task');
	await addAction.getByLabel('Fällig am (optional)').fill('2099-01-01');
	await addAction.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();

	const step = page.locator('.timeline__step', { hasText: 'Snooze rejected task' });
	await step.getByRole('button', { name: 'Später erinnern' }).click();
	const pastDate = isoDaysFromToday(-5);
	await step.getByLabel('Anderes Datum').fill(pastDate);
	await step.getByRole('button', { name: 'Setzen' }).click();

	const dialog = step.locator('dialog.action-dialog').filter({ hasText: 'Später erinnern' });
	await expect(dialog).toBeVisible();
	await expect(
		dialog.getByText('Bitte ein Datum innerhalb der nächsten 365 Tage wählen.')
	).toBeVisible();
	await expect(dialog.getByLabel('Anderes Datum')).toHaveValue(pastDate);
});

test('dialog closes only on a true backdrop tap, not a tap inside its own padding', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Dialog Backdrop Test');
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
	const addAction = page.locator('form[action="?/addManualAction"]');
	await addAction.getByLabel('Bezeichnung der Aufgabe').fill('Dialog backdrop task');
	await addAction.getByLabel('Fällig am (optional)').fill('2099-01-01');
	await addAction.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();

	const step = page.locator('.timeline__step', { hasText: 'Dialog backdrop task' });
	await step.getByRole('button', { name: 'Später erinnern' }).click();
	const dialog = step.locator('dialog.action-dialog');
	await expect(dialog).toBeVisible();

	// A tap inside the dialog's own padding (not on any control) must not
	// dismiss it — only a tap outside the dialog's box (the ::backdrop)
	// should.
	await dialog.click({ position: { x: 5, y: 5 } });
	await expect(dialog).toBeVisible();

	await page.mouse.click(2, 2);
	await expect(dialog).not.toBeVisible();
});

test('English catalog renders the compact Action rows', async ({ page }) => {
	// Explicit Settings toggle, not a browser Accept-Language guess — this
	// sets the persisted language regardless of the host locale.
	await page.goto('/settings');
	await page.locator('#g-language form button[value="en"]').click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');

	await page.goto('/items/new');
	await page.getByLabel('Title').fill('English Compact UX Test');
	await page.getByRole('button', { name: 'Create' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	await page.locator('summary', { hasText: 'Edit details' }).click();
	await page.locator('summary', { hasText: 'Add task' }).click();
	const addAction = page.locator('form[action="?/addManualAction"]');
	await addAction.getByLabel('Task label').fill('English task');
	await addAction.getByLabel('Due date (optional)').fill('2099-01-01');
	await addAction.getByRole('button', { name: 'Add task' }).click();

	const step = page.locator('.timeline__step', { hasText: 'English task' });
	await expect(step.getByRole('button', { name: 'Mark done' })).toBeVisible();
	await expect(step.getByRole('button', { name: 'Skip' })).toBeVisible();

	const remindTrigger = step.getByRole('button', { name: 'Remind me later' });
	await expect(remindTrigger).toBeVisible();
	await expect(step.getByRole('button', { name: 'Tomorrow' })).toHaveCount(0);
	await remindTrigger.click();
	await expect(step.getByRole('button', { name: 'Tomorrow' })).toBeVisible();
	await expect(step.getByRole('button', { name: 'In 3 days' })).toBeVisible();
	await expect(step.getByRole('button', { name: 'In 7 days' })).toBeVisible();
	await expect(step.getByRole('button', { name: 'Cancel' })).toBeVisible();

	// Reset back to German/browser default so later specs are unaffected.
	await page.goto('/settings');
	await page.locator('#g-language form button[value="browser"]').click();
});
