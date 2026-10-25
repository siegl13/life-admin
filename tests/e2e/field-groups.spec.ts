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
	return page.locator('.field-groups__row').filter({
		has: page.getByLabel(`Weitere Aktionen für Gruppe: ${name}`)
	});
}

function languageButton(page: Page, language: 'browser' | 'de' | 'en') {
	return page.locator(`#g-language form button[value="${language}"]`);
}

async function addGroup(manager: Locator, name: string) {
	await manager.locator('details.group-add > summary').click();
	await manager.getByLabel('Neue Gruppe').fill(name);
	await manager.getByRole('button', { name: 'Gruppe anlegen' }).click();
}

async function openGroupMenu(page: Page, name: string) {
	const row = groupRow(page, name);
	await row.getByLabel(`Weitere Aktionen für Gruppe: ${name}`).click();
	return row;
}

/** Reassigns a field through the group select of the edit form and saves. */
async function moveFieldInEditForm(page: Page, fieldId: string, group: string) {
	const panel = page.locator('details.fields-panel').filter({ has: page.locator('#fields-label') });
	if (!(await panel.evaluate((node) => (node as HTMLDetailsElement).open))) {
		await panel.locator(':scope > summary').click();
	}
	await page.locator(`#group-${fieldId}`).selectOption({ label: group });
}

test('groups are created, filled, featured, renamed and keep their state after reload', async ({
	page
}) => {
	await createItem(page, 'Field Groups Test', 'TÜV / Hauptuntersuchung');

	const creator = await openGroupManager(page);
	await addGroup(creator, 'Versicherung');
	await expect(page).toHaveURL(/\?manage=groups#field-groups$/);

	// The separate field-move form is gone; the edit form carries the group select.
	const manager = await openGroupManager(page);
	await expect(manager.getByRole('button', { name: 'Verschieben' })).toHaveCount(0);
	await moveFieldInEditForm(page, 'license_plate', 'Versicherung');
	await page.locator('#license_plate').fill('AB-CD 123');
	await page.locator('input[type="date"]').first().fill('2030-05-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	const labels = page.locator('.facts-view .facts-group__label');
	await expect(labels).toHaveText(['Prüfung', 'Versicherung']);
	await expect(page.locator('.facts-group').nth(1)).toContainText('AB-CD 123');

	// Direct star toggle in the item information.
	await page
		.locator('.facts-view')
		.getByRole('button', { name: 'Gruppe hervorheben: Versicherung' })
		.click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+#fields-label$/);
	await expect(labels).toHaveText(['Versicherung Hervorgehoben', 'Prüfung']);

	await page.reload();
	await expect(labels).toHaveText(['Versicherung Hervorgehoben', 'Prüfung']);
	await expect(
		page.locator('.facts-view').getByRole('button', { name: 'Gruppe hervorheben: Versicherung' })
	).toHaveAttribute('aria-pressed', 'true');

	await openGroupManager(page);
	const row = await openGroupMenu(page, 'Versicherung');
	await row.getByLabel('Gruppe umbenennen: Versicherung').fill('Policen');
	await row.getByRole('button', { name: 'Umbenennen' }).click();
	await expect(labels.first()).toContainText('Policen');

	await openGroupManager(page);
	await groupRow(page, 'Policen')
		.getByRole('button', { name: 'Gruppe hervorheben: Policen' })
		.click();
	await expect(labels).toHaveText(['Prüfung', 'Policen']);
});

test('group menus offer only valid moves and a move persists after reload', async ({ page }) => {
	await createItem(page, 'Group Menu Moves Test');
	for (const name of ['Alpha', 'Beta', 'Gamma']) {
		await addGroup(await openGroupManager(page), name);
	}
	// Stored order: Allgemein, Alpha, Beta, Gamma. Gamma featured sits alone in the featured list.
	await openGroupManager(page);
	await groupRow(page, 'Gamma').getByRole('button', { name: 'Gruppe hervorheben: Gamma' }).click();

	const moveUp = (name: string) => `Gruppe nach oben: ${name}`;
	const moveDown = (name: string) => `Gruppe nach unten: ${name}`;
	async function menu(name: string) {
		await openGroupManager(page);
		const row = groupRow(page, name);
		const toggle = row.locator('details.group-menu');
		if (!(await toggle.evaluate((node) => (node as HTMLDetailsElement).open))) {
			await row.getByLabel(`Weitere Aktionen für Gruppe: ${name}`).click();
		}
		return row;
	}

	// Featured Gamma is alone in its list: no move, no crossing into the other list.
	const gamma = await menu('Gamma');
	await expect(gamma.getByRole('button', { name: moveUp('Gamma') })).toHaveCount(0);
	await expect(gamma.getByRole('button', { name: moveDown('Gamma') })).toHaveCount(0);

	// First non-featured group: no move up. Last non-featured group: no move down.
	const first = await menu('Allgemein');
	await expect(first.getByRole('button', { name: moveUp('Allgemein') })).toHaveCount(0);
	await expect(first.getByRole('button', { name: moveDown('Allgemein') })).toHaveCount(1);
	const last = await menu('Beta');
	await expect(last.getByRole('button', { name: moveUp('Beta') })).toHaveCount(1);
	await expect(last.getByRole('button', { name: moveDown('Beta') })).toHaveCount(0);
	await last.getByRole('button', { name: moveUp('Beta') }).click();

	await page.reload();
	await openGroupManager(page);
	await expect(page.locator('.field-groups__name')).toHaveText([
		'Gamma',
		'Allgemein',
		'Beta',
		'Alpha'
	]);
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

test('a custom field is reassigned while editing and keeps its value and key', async ({ page }) => {
	await createItem(page, 'Field Groups Custom Move Test');
	const panel = page.locator('details.fields-panel').filter({ has: page.locator('#fields-label') });
	await panel.locator(':scope > summary').click();
	await page.locator('summary', { hasText: 'Angabe hinzufügen' }).click();
	const addForm = page.locator('form[action="?/addField"]');
	await addForm.getByLabel('Bezeichnung', { exact: true }).fill('Notiz');
	await addForm.getByRole('button', { name: 'Angabe hinzufügen' }).click();

	const manager = await openGroupManager(page);
	await addGroup(manager, 'Details');
	await page.locator('#c_notiz').fill('bleibt');
	await moveFieldInEditForm(page, 'c_notiz', 'Details');
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();

	const labels = page.locator('.facts-view .facts-group__label');
	await expect(labels).toHaveText(['Details']);
	await expect(page.locator('.facts-group')).toContainText('bleibt');
	await page.reload();
	await expect(labels).toHaveText(['Details']);
	await expect(page.locator('.facts-group')).toContainText('Notiz');
});

test('Group controls work in German and English with keyboard and native select interaction', async ({
	page
}) => {
	const itemId = await createItem(page, 'Bilingual Group Controls');
	const itemUrl = `/items/${itemId}`;
	const panel = page.locator('details.fields-panel').filter({ has: page.locator('#fields-label') });
	await panel.locator(':scope > summary').click();
	await page.locator('summary', { hasText: 'Angabe hinzufügen' }).click();
	const addForm = page.locator('form[action="?/addField"]');
	await addForm.getByLabel('Bezeichnung', { exact: true }).fill('Notiz');
	await addForm.getByRole('button', { name: 'Angabe hinzufügen' }).click();

	const manager = await openGroupManager(page);
	await addGroup(manager, 'Belege');
	await page.locator('#c_notiz').fill('bleibt erhalten');
	const germanGroupSelect = page.locator('#group-c_notiz');
	await germanGroupSelect.click();
	await germanGroupSelect.selectOption({ label: 'Belege' });
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect(page.locator('.facts-group')).toContainText('bleibt erhalten');

	const germanStar = page
		.locator('.facts-view')
		.getByRole('button', { name: 'Gruppe hervorheben: Belege' });
	await expect(germanStar).toHaveAttribute('aria-pressed', 'false');
	await germanStar.focus();
	await germanStar.press('Enter');
	await expect(
		page.locator('.facts-view').getByRole('button', { name: 'Gruppe hervorheben: Belege' })
	).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('.facts-group__label').first()).toContainText('Belege');

	await openGroupManager(page);
	const germanRow = groupRow(page, 'Belege');
	const germanMenuSummary = page.getByLabel('Weitere Aktionen für Gruppe: Belege');
	await germanMenuSummary.focus();
	await germanMenuSummary.press('Enter');
	const germanMenu = germanRow.locator('details.group-menu');
	await expect(germanMenu).toHaveAttribute('open', '');
	await expect(germanMenuSummary).toBeFocused();
	await page.keyboard.press('Tab');
	const germanRename = germanRow.getByLabel('Gruppe umbenennen: Belege');
	await expect(germanRename).toBeFocused();
	await expect(germanRename).toHaveCSS('outline-style', 'solid');
	await germanRename.fill('Unterlagen');
	await germanRow.getByRole('button', { name: 'Umbenennen' }).click();
	await expect(page.locator('.facts-group__label').first()).toContainText('Unterlagen');
	await page.reload();
	await expect(page.locator('.facts-group__label').first()).toContainText('Unterlagen');

	await page.goto('/settings');
	await languageButton(page, 'en').click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await page.goto(itemUrl);
	const englishGroupStar = page
		.locator('.facts-view')
		.getByRole('button', { name: 'Feature group: Unterlagen' });
	await expect(englishGroupStar).toHaveAttribute('aria-pressed', 'true');
	await englishGroupStar.click();
	await expect(
		page.locator('.facts-view').getByRole('button', { name: 'Feature group: Unterlagen' })
	).toHaveAttribute('aria-pressed', 'false');

	await openGroupManager(page);
	const englishRow = page.locator('.field-groups__row').filter({
		has: page.getByLabel('More actions for group: Unterlagen')
	});
	await englishRow.getByLabel('More actions for group: Unterlagen').click();
	await englishRow.getByLabel('Rename group: Unterlagen').fill('Documents');
	await englishRow.getByRole('button', { name: 'Rename', exact: true }).click();
	await expect(page.locator('.facts-group__label').first()).toContainText('Documents');

	const fieldsPanel = page.locator('details.fields-panel').filter({
		has: page.locator('#fields-label')
	});
	if (!(await fieldsPanel.evaluate((element) => (element as HTMLDetailsElement).open))) {
		await fieldsPanel.locator(':scope > summary').click();
	}
	const englishSelect = page.locator('#group-c_notiz');
	await expect(englishSelect.locator('option:checked')).toHaveText('Documents');
	await expect(englishSelect.locator('option')).toHaveText(['General', 'Documents']);
	await englishSelect.selectOption({ label: 'General' });
	await englishSelect.focus();
	await englishSelect.press('D');
	await expect(englishSelect.locator('option:checked')).toHaveText('Documents');
	await englishSelect.selectOption({ label: 'General' });
	await expect(englishSelect.locator('option:checked')).toHaveText('General');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await page.reload();
	await expect(page.locator('.facts-group__label').first()).toContainText('General');
	await expect(page.locator('.facts-group')).toContainText('bleibt erhalten');
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');

	await page.setViewportSize({ width: 375, height: 812 });
	const rowAfterReload = page.locator('.facts-group').filter({
		has: page.locator('.facts-group__label', { hasText: 'General' })
	});
	const starBox = await rowAfterReload.locator('.group-star__button').boundingBox();
	expect(starBox?.width).toBeGreaterThanOrEqual(44);
	expect(starBox?.height).toBeGreaterThanOrEqual(44);
	await openGroupManager(page);
	const overflowBox = await page.getByLabel('More actions for group: Documents').boundingBox();
	expect(overflowBox?.width).toBeGreaterThanOrEqual(44);
	expect(overflowBox?.height).toBeGreaterThanOrEqual(44);
	await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 375);

	await page.goto('/settings');
	await languageButton(page, 'browser').click();
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
	await addGroup(manager, name);
	await expect(groupRow(page, name)).toBeVisible();
	await moveFieldInEditForm(page, 'license_plate', name);
	await page.locator('#license_plate').fill('AB-CD 123');
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	const fieldset = page.locator('fieldset.fields-update-form__group').filter({
		has: page.locator('legend', { hasText: name })
	});

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
		await expect(heading.locator('xpath=ancestor::section[1]')).toContainText('AB-CD 123');
		await panel.locator(':scope > summary').click();
		await expectWrapped(fieldset.locator('legend'));
		await expect(fieldset.locator('#license_plate')).toHaveValue('AB-CD 123');
		await panel.locator(':scope > summary').click();
	}
});
