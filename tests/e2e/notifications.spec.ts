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
