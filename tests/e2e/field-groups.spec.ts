import { expect, test, type Locator, type Page } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4173';
const createdItems = new WeakMap<Page, string[]>();

async function createItem(page: Page, title: string, playbook?: string): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	if (playbook) await page.getByLabel('Vorlage').selectOption({ label: playbook });
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

async function openGroupManager(page: Page) {
	const manager = page.locator('details#field-groups');
	if (!(await manager.evaluate((node) => (node as HTMLDetailsElement).open).catch(() => false))) {
		const panel = page
			.locator('details.fields-panel')
			.filter({ has: page.locator('#fields-label') });
		if (!(await panel.evaluate((node) => (node as HTMLDetailsElement).open))) {
			await panel.locator(':scope > summary').click();
		}
		await manager.locator(':scope > summary').click();
	}
	return manager;
}

function groupRow(page: Page, name: string) {
	return page.locator('.field-groups__item').filter({
		has: page.getByLabel(`Gruppe umbenennen: ${name}`)
	});
}

test('groups are created, filled, featured, renamed and keep their state after reload', async ({
	page
}) => {
	await createItem(page, 'Field Groups Test', 'TÜV / Hauptuntersuchung');

	const creator = await openGroupManager(page);
	await creator.getByLabel('Neue Gruppe').fill('Versicherung');
	await creator.getByRole('button', { name: 'Gruppe anlegen' }).click();
	await expect(page).toHaveURL(/\?manage=groups#field-groups$/);

	const manager = await openGroupManager(page);
	await manager
		.getByLabel('Angabe', { exact: true })
		.selectOption({ label: 'Kennzeichen (Fahrzeug)' });
	await manager.getByLabel('Zielgruppe').selectOption({ label: 'Versicherung' });
	await manager.getByRole('button', { name: 'Verschieben' }).click();
	await expect(page).toHaveURL(/\?manage=groups#field-groups$/);

	// The moved field is edited under its new group heading.
	await expect(
		page
			.locator('fieldset.fields-update-form__group', { hasText: 'Versicherung' })
			.locator('#license_plate')
	).toBeVisible();
	await page.locator('#license_plate').fill('AB-CD 123');
	await page.locator('input[type="date"]').first().fill('2030-05-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	const labels = page.locator('.facts-view .facts-group__label');
	await expect(labels).toHaveText(['Prüfung', 'Versicherung']);
	await expect(page.locator('.facts-group').nth(1)).toContainText('AB-CD 123');

	await openGroupManager(page);
	await groupRow(page, 'Versicherung')
		.getByRole('button', { name: 'Hervorheben', exact: true })
		.click();
	await expect(labels).toHaveText(['Versicherung Hervorgehoben', 'Prüfung']);

	await page.reload();
	await expect(labels).toHaveText(['Versicherung Hervorgehoben', 'Prüfung']);

	await openGroupManager(page);
	await groupRow(page, 'Versicherung')
		.getByLabel('Gruppe umbenennen: Versicherung')
		.fill('Policen');
	await groupRow(page, 'Versicherung').getByRole('button', { name: 'Umbenennen' }).click();
	await expect(labels.first()).toContainText('Policen');

	await openGroupManager(page);
	await groupRow(page, 'Policen')
		.getByRole('button', { name: 'Nicht mehr hervorheben', exact: true })
		.click();
	await expect(labels).toHaveText(['Prüfung', 'Policen']);
});

test('custom fields land in Allgemein and empty fields stay hidden but editable', async ({
	page
}) => {
	await createItem(page, 'Field Groups Custom Test');
	const panel = page.locator('details.fields-panel').filter({ has: page.locator('#fields-label') });
	await panel.locator(':scope > summary').click();
	await page.locator('summary', { hasText: 'Angabe hinzufügen' }).click();
	const addForm = page.locator('form[action="?/addField"]');
	await addForm.getByLabel('Bezeichnung', { exact: true }).fill('Notiz');
	await addForm.getByRole('button', { name: 'Angabe hinzufügen' }).click();

	// Reaches the new field in the manage form, grouped under Allgemein.
	if (!(await panel.evaluate((node) => (node as HTMLDetailsElement).open))) {
		await panel.locator(':scope > summary').click();
	}
	await expect(
		page.locator('fieldset.fields-update-form__group', { hasText: 'Allgemein' }).locator('#c_notiz')
	).toBeVisible();

	await expect(page.locator('.facts-group')).toHaveCount(0);
	const empty = page.locator('.facts-empty');
	await expect(empty.locator('summary')).toHaveText('1 leere Angabe');
});

test('a custom-item upload control stays clear of the phone navigation', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await createItem(page, 'Custom upload navigation clearance');

	const uploadPicker = page.locator('.upload-picker');
	await expect(uploadPicker).toBeVisible();
	const pickerBox = await uploadPicker.boundingBox();
	const tabbarBox = await page.locator('.app-tabbar').boundingBox();
	expect(pickerBox).not.toBeNull();
	expect(tabbarBox).not.toBeNull();
	expect(pickerBox!.y + pickerBox!.height).toBeLessThanOrEqual(tabbarBox!.y);
	await expect(page.locator('.page-head__more-link')).toBeHidden();
});

test('maximum-length group names wrap inside viewing cards and editing legends on phones', async ({
	page
}) => {
	const name = 'W'.repeat(80);
	await createItem(page, 'Long group name test', 'TÜV / Hauptuntersuchung');
	const manager = await openGroupManager(page);
	await manager.getByLabel('Neue Gruppe').fill(name);
	await manager.getByRole('button', { name: 'Gruppe anlegen' }).click();
	await expect(groupRow(page, name)).toBeVisible();
	await manager
		.getByLabel('Angabe', { exact: true })
		.selectOption({ label: 'Kennzeichen (Fahrzeug)' });
	await manager.getByLabel('Zielgruppe').selectOption({ label: name });
	await manager.getByRole('button', { name: 'Verschieben' }).click();
	const fieldset = page.locator('fieldset.fields-update-form__group').filter({
		has: page.locator('legend', { hasText: name })
	});
	await expect(fieldset.locator('#license_plate')).toBeVisible();
	await fieldset.locator('#license_plate').fill('AB-CD 123');
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();

	async function expectWrapped(label: Locator) {
		await expect(label).toBeVisible();
		await expect(label).toHaveText(name);
		await expect
			.poll(() =>
				label.evaluate((node) => {
					const bounds = node.getBoundingClientRect();
					const container = node.parentElement!.getBoundingClientRect();
					const text = document.createRange();
					text.selectNodeContents(node);
					const fragments = [...text.getClientRects()];
					return (
						fragments.length > 1 &&
						fragments.every(
							(rect) => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
						) &&
						bounds.left >= container.left - 1 &&
						bounds.right <= container.right + 1 &&
						node.scrollWidth <= node.clientWidth + 1 &&
						document.documentElement.scrollWidth <= window.innerWidth
					);
				})
			)
			.toBe(true);
	}

	const panel = page.locator('details.fields-panel').filter({ has: page.locator('#fields-label') });
	const heading = page.locator('.facts-view .facts-group__label').filter({ hasText: name });
	for (const width of [375, 390, 430]) {
		await page.setViewportSize({ width, height: 844 });
		await expectWrapped(heading);
		await expect(heading.locator('..')).toContainText('AB-CD 123');
		await panel.locator(':scope > summary').click();
		await expectWrapped(fieldset.locator('legend'));
		await expect(fieldset.locator('#license_plate')).toHaveValue('AB-CD 123');
		await panel.locator(':scope > summary').click();
	}
});
