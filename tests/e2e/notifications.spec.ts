import { expect, test } from '@playwright/test';

test('notification settings validate input, keep secrets hidden, and support test delivery', async ({
	page
}) => {
	await page.goto('/settings');
	const ntfyForm = page.locator('#notify-channel-ntfy form');

	// Each channel disclosure defaults closed; a failed save re-opens its
	// own channel automatically (see `open={form?.notificationChannel ===
	// ...}`), but a successful save redirects with no form state, so it
	// closes again and has to be reopened by hand before the next round.
	await page.locator('#notify-channel-ntfy > summary').click();
	await ntfyForm.getByLabel('ntfy-Server').fill('file:///tmp/not-a-server');
	await ntfyForm.getByRole('button', { name: 'Speichern' }).click();
	await expect(
		page.getByText('Bitte gib eine gültige http- oder https-Adresse ein.')
	).toBeVisible();

	await ntfyForm.getByLabel('ntfy-Server').fill('https://ntfy.example');
	await ntfyForm.getByLabel('ntfy-Thema').fill('ab');
	await ntfyForm.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText(/Das Thema muss 4 bis 64/)).toBeVisible();

	await ntfyForm.getByLabel('ntfy-Thema').fill('household_topic');
	await ntfyForm.getByLabel('Tage vorher').fill('500');
	await ntfyForm.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Die Anzahl der Tage muss zwischen 0 und 90 liegen.')).toBeVisible();

	const token = 'notification-e2e-secret';
	await ntfyForm.getByLabel('Tage vorher').fill('7');
	await ntfyForm.getByLabel('ntfy-Thema').fill('household_topic');
	await ntfyForm.getByLabel('ntfy-Zugangsschlüssel').fill(token);
	await ntfyForm.getByLabel('Erinnerungen einschalten').check();
	await ntfyForm.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Eingeschaltet', { exact: true })).toBeVisible();
	// Successful save redirected with no form state; the channel closed.
	await page.locator('#notify-channel-ntfy > summary').click();
	await expect(page.getByText('Ein Zugangsschlüssel ist hinterlegt.')).toBeVisible();
	await expect(page.locator(`input[value="${token}"]`)).toHaveCount(0);
	await expect(page.getByText(token)).toHaveCount(0);

	await ntfyForm.getByRole('button', { name: 'Testbenachrichtigung senden' }).click();
	await expect(page.getByText('Testbenachrichtigung gesendet.')).toBeVisible();

	await page.locator('#notify-channel-ntfy > summary').click();
	await ntfyForm.getByLabel('Zugangsschlüssel entfernen').check();
	await ntfyForm.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Ein Zugangsschlüssel ist hinterlegt.')).toHaveCount(0);

	await page.locator('#notify-channel-slack > summary').click();
	const slackForm = page.locator('#notify-channel-slack form');
	await slackForm.getByLabel('Slack Webhook-Adresse').fill('https://example.test/hook');
	await slackForm.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Die Slack Webhook-Adresse ist ungültig.')).toBeVisible();

	const webhook = 'https://hooks.slack.com/services/e2e/secret/webhook';
	await slackForm.getByLabel('Slack Webhook-Adresse').fill(webhook);
	await slackForm.getByLabel('Sparsame Erinnerungen').check();
	await slackForm.getByRole('button', { name: 'Speichern' }).click();
	// Successful save redirected with no form state; the channel closed.
	await page.locator('#notify-channel-slack > summary').click();
	await expect(page.getByText('Eine Webhook-Adresse ist hinterlegt.')).toBeVisible();
	await expect(page.locator(`input[value="${webhook}"]`)).toHaveCount(0);
	await expect(page.getByText(webhook)).toHaveCount(0);
	await expect(slackForm.getByLabel('Sparsame Erinnerungen')).toBeChecked();

	await slackForm.getByRole('button', { name: 'Testbenachrichtigung senden' }).click();
	await expect(page.getByText('Testbenachrichtigung gesendet.')).toBeVisible();

	await page.locator('#notify-channel-slack > summary').click();
	await slackForm.getByLabel('Webhook-Adresse entfernen').check();
	await slackForm.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Eine Webhook-Adresse ist hinterlegt.')).toHaveCount(0);
});

test('testing a channel checks the current draft, not the saved settings', async ({ page }) => {
	await page.goto('/settings');
	await page.locator('#notify-channel-slack > summary').click();
	const slackForm = page.locator('#notify-channel-slack form');

	// Nothing saved for this channel yet: testing an unsaved draft webhook
	// still works, without ever clicking "Speichern".
	await slackForm
		.getByLabel('Slack Webhook-Adresse')
		.fill('https://hooks.slack.com/services/draft/only/webhook');
	await slackForm.getByRole('button', { name: 'Testbenachrichtigung senden' }).click();
	await expect(page.getByText('Testbenachrichtigung gesendet.')).toBeVisible();

	// Nothing was persisted by the test — the channel still shows as not
	// configured after a reload.
	await page.reload();
	await expect(page.getByText('Nicht eingerichtet', { exact: true }).first()).toBeVisible();

	// An invalid draft is rejected the same way "Speichern" would reject
	// it, before any send is attempted.
	await page.locator('#notify-channel-slack > summary').click();
	await slackForm.getByLabel('Slack Webhook-Adresse').fill('https://not-slack.example.com/hook');
	await slackForm.getByRole('button', { name: 'Testbenachrichtigung senden' }).click();
	await expect(page.getByText('Die Slack Webhook-Adresse ist ungültig.')).toBeVisible();
});

test('snoozed actions retain overdue context and can be replaced directly', async ({ page }) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Snooze UI Test');
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
	const addAction = page.locator('form[action="?/addManualAction"]');
	await addAction.getByLabel('Bezeichnung der Aufgabe').fill('Snoozed overdue task');
	await addAction.getByLabel('Fällig am (optional)').fill('2020-01-01');
	await addAction.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();

	const step = page.locator('.timeline__step', { hasText: 'Snoozed overdue task' });
	// Presets stay hidden behind the compact "Später erinnern" trigger row
	// until opened — never shown alongside Erledigen/Überspringen by
	// default.
	await expect(step.getByRole('button', { name: 'Morgen' })).toHaveCount(0);
	await step.getByRole('button', { name: 'Später erinnern' }).click();
	await step.getByRole('button', { name: 'Morgen' }).click();
	await expect(step.getByText('Überfällig seit 1. Januar 2020')).toBeVisible();
	await expect(step.getByText('Erneut erinnern am')).toBeVisible();
	await step.getByRole('button', { name: 'Erinnerungsdatum ändern' }).click();
	await step.getByRole('button', { name: 'In 7 Tagen' }).click();
	await expect(step.getByText('Erneut erinnern am')).toBeVisible();

	await step.getByRole('button', { name: 'Erinnerung löschen' }).click();
	await expect(step.getByText('Erneut erinnern am')).toHaveCount(0);

	await step.getByRole('button', { name: 'Später erinnern' }).click();
	await step.getByRole('button', { name: 'Morgen' }).click();
	await expect(step.getByText('Erneut erinnern am')).toBeVisible();
	const maximumSnoozeDate = new Date();
	maximumSnoozeDate.setDate(maximumSnoozeDate.getDate() + 365);
	await step.getByRole('button', { name: 'Erinnerungsdatum ändern' }).click();
	const customDate = step.getByLabel('Anderes Datum');
	await customDate.fill(maximumSnoozeDate.toISOString().slice(0, 10));
	await step.getByRole('button', { name: 'Setzen' }).click();
	await expect(step.getByText('Erneut erinnern am')).toBeVisible();
	await page.setViewportSize({ width: 375, height: 667 });
	await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375);

	await page.locator('summary', { hasText: 'Archivieren' }).click();
	await page.getByRole('button', { name: 'Archivieren' }).click();
	await expect(step.getByRole('button', { name: 'Morgen' })).toHaveCount(0);
	await expect(step.getByText('Erneut erinnern am')).toHaveCount(0);
});

test('anonymous users cannot submit a snooze mutation', async ({ page }) => {
	await page.context().clearCookies();
	const response = await page.request.post('/items/not-an-item?/setSnooze', {
		form: { actionId: 'unknown', snoozedUntil: 'TOMORROW' },
		maxRedirects: 0
	});
	// SvelteKit rejects a form POST without a trusted Origin before the
	// unauthenticated route guard can redirect it.
	expect(response.status()).toBe(403);
});

test('snooze forms submit without JavaScript', async ({ browser }) => {
	const context = await browser.newContext({
		storageState: '.data-e2e/playwright-auth.json',
		javaScriptEnabled: false,
		locale: 'de-DE'
	});
	const page = await context.newPage();
	try {
		await page.goto('/items/new');
		await page.getByLabel('Titel').fill('Snooze without JavaScript');
		await page.getByRole('button', { name: 'Anlegen' }).click();
		await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

		await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
		await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
		const addAction = page.locator('form[action="?/addManualAction"]');
		await addAction.getByLabel('Bezeichnung der Aufgabe').fill('No JavaScript task');
		await addAction.getByLabel('Fällig am (optional)').fill('2099-01-01');
		await addAction.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();

		const step = page.locator('.timeline__step', { hasText: 'No JavaScript task' });
		// The editor dialog renders statically `open` (no `showModal()` call
		// ever ran to close it), so it's already visible and usable with no
		// JavaScript at all — no trigger click needed.
		await step.getByRole('button', { name: 'Morgen' }).click();
		await expect(step.getByText('Erneut erinnern am')).toBeVisible();
	} finally {
		await context.close();
	}
});
