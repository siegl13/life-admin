import { expect, test } from '@playwright/test';

test.use({ javaScriptEnabled: false });

function yaml(id: string, version = '1.0.0'): string {
	return [
		`schemaVersion: 1`,
		`id: ${id}`,
		`version: ${version}`,
		`name: ${id}`,
		'actions:',
		'  - key: check',
		'    label: Check'
	].join('\n');
}

test('installs, offers, and removes a pasted playbook without changing its item', async ({
	page
}) => {
	const id = `de.test.install${Date.now()}`;
	await page.goto('/settings');
	await page.getByText('Vorlage hinzufügen').click();
	await page.locator('#playbook-yaml').fill(yaml(id));
	await page.getByRole('button', { name: 'Vorlage installieren' }).click();
	await expect(page.getByText(id)).toBeVisible();
	await page.goto('/items/new');
	await expect(page.getByLabel('Vorlage')).toContainText(id);
	await page.getByLabel('Titel').fill(`Installed ${id}`);
	await page.getByLabel('Vorlage').selectOption({ label: id });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page.getByText(`Angelegt aus der Vorlage: ${id}`)).toBeVisible();
	const itemUrl = page.url();
	await page.goto('/settings');
	await page.getByRole('button', { name: 'Entfernen' }).last().click();
	await expect(page.getByText(id)).toHaveCount(0);
	await page.goto(itemUrl);
	await expect(page.getByText(`Angelegt aus der Vorlage: ${id}`)).toBeVisible();
});

test('rejects ambiguous playbook sources without installing either', async ({ page }) => {
	const id = `de.test.ambiguous${Date.now()}`;
	await page.goto('/settings');
	await page.getByText('Vorlage hinzufügen').click();
	await page.locator('#playbook-yaml').fill(yaml(id));
	await page.locator('#playbook-file').setInputFiles({
		name: 'playbook.yaml',
		mimeType: 'text/yaml',
		buffer: Buffer.from(yaml(`${id}.file`))
	});
	await page.getByRole('button', { name: 'Vorlage installieren' }).click();
	await expect(
		page.getByText('Füge genau eine YAML-Quelle ein oder lade genau eine YAML-Datei hoch.')
	).toBeVisible();
	await expect(page.getByText(id)).toHaveCount(0);
});

test('rejects a submission without a playbook source', async ({ page }) => {
	await page.goto('/settings');
	await page.getByText('Vorlage hinzufügen').click();
	await page.getByRole('button', { name: 'Vorlage installieren' }).click();
	await expect(
		page.getByText('Füge genau eine YAML-Quelle ein oder lade genau eine YAML-Datei hoch.')
	).toBeVisible();
});

test('installs an uploaded playbook without pasted YAML', async ({ page }) => {
	const id = `de.test.upload${Date.now()}`;
	await page.goto('/settings');
	await page.getByText('Vorlage hinzufügen').click();
	await page.locator('#playbook-file').setInputFiles({
		name: 'playbook.yaml',
		mimeType: 'text/yaml',
		buffer: Buffer.from(yaml(id))
	});
	await page.getByRole('button', { name: 'Vorlage installieren' }).click();
	await expect(page.getByText(id)).toBeVisible();
});

test('replaces a custom playbook only after confirmation and shows the newer version on existing items', async ({
	page
}) => {
	const id = `de.test.replace${Date.now()}`;
	await page.goto('/settings');
	await page.getByText('Vorlage hinzufügen').click();
	await page.locator('#playbook-yaml').fill(yaml(id));
	await page.getByRole('button', { name: 'Vorlage installieren' }).click();

	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(`Installed ${id}`);
	await page.getByLabel('Vorlage').selectOption({ label: id });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	const itemUrl = page.url();

	await page.goto('/settings');
	await page.getByText('Vorlage hinzufügen').click();
	await page.locator('#playbook-yaml').fill(yaml(id, '1.1.0'));
	await page.getByRole('button', { name: 'Vorlage installieren' }).click();
	await expect(
		page.getByText(
			'Diese Vorlage ist bereits installiert. Bestätige das Ersetzen, um sie zu ändern.'
		)
	).toBeVisible();
	await expect(page.locator(`[id="g-playbook-${id}"]`)).toContainText('1.0.0');

	await page.locator('#playbook-yaml').fill(yaml(id, '1.1.0'));
	await page.getByLabel('Vorhandene Vorlage ersetzen').check();
	await page.getByRole('button', { name: 'Vorlage installieren' }).click();
	await expect(page.locator(`[id="g-playbook-${id}"]`)).toContainText('1.1.0');

	await page.goto(itemUrl);
	await expect(
		page.getByText(
			'Von dieser Vorlage ist inzwischen Version 1.1.0 verfügbar. Dieses Element bleibt unverändert.'
		)
	).toBeVisible();
});

test('rejects a custom playbook that collides with a bundled id', async ({ page }) => {
	await page.goto('/settings');
	await page.getByText('Vorlage hinzufügen').click();
	await page.locator('#playbook-yaml').fill(yaml('de.travel.booking'));
	await page.getByRole('button', { name: 'Vorlage installieren' }).click();
	await expect(
		page.getByText(
			'Diese Vorlage hat dieselbe Kennung wie eine mitgelieferte Vorlage und würde nicht verwendet.'
		)
	).toBeVisible();
});

test('shows validation reasons and installs no invalid playbook', async ({ page }) => {
	const id = `de.test.invalid${Date.now()}`;
	await page.goto('/settings');
	await page.getByText('Vorlage hinzufügen').click();
	await page.locator('#playbook-yaml').fill(`schemaVersion: 1\nid: ${id}\nversion: 1.0.0`);
	await page.getByRole('button', { name: 'Vorlage installieren' }).click();
	await expect(page.locator('.notice--error li')).not.toHaveCount(0);
	await expect(page.getByText(id)).toHaveCount(0);
});
