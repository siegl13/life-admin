import { expect, test } from '@playwright/test';

test('backup downloads as ZIP and invalid restore changes nothing', async ({ page }) => {
	await page.goto('/settings');
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Backup herunterladen' }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/^lifeadmin-backup-\d{8}-\d{6}-[0-9a-f]{6}\.zip$/);
	const stream = await download.createReadStream();
	const first = await new Promise<Buffer>((resolve) => stream.once('data', resolve));
	expect(first.subarray(0, 4).toString()).toBe('PK\u0003\u0004');

	await page.locator('summary', { hasText: 'Backup wiederherstellen' }).click();
	await page.getByLabel('Backup-Datei').setInputFiles({
		name: 'kaputt.zip',
		mimeType: 'application/zip',
		buffer: Buffer.from('not a zip')
	});
	await page.getByLabel(/Ich weiß/).check();
	// Scoped to the restore form: an unscoped name match also resolves the
	// AI section's "Standard wiederherstellen" button (Slice 9).
	await page
		.locator('form[action="?/restore"]')
		.getByRole('button', { name: 'Wiederherstellen' })
		.click();
	// A garbage upload categorizes as NOT_A_BACKUP, which gets its own specific
	// message rather than a generic "could not be restored" notice.
	await expect(
		page.getByText(/kein gültiges oder ist ein beschädigtes Life-Admin-Backup/)
	).toBeVisible();
	await expect(page.getByText('Die aktuellen Daten wurden nicht verändert.')).toBeVisible();
});
