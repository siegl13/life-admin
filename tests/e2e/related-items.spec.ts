import { expect, test } from '@playwright/test';

const MINIMAL_PDF = Buffer.from('%PDF-1.4\n%%EOF');

async function createItem(page: import('@playwright/test').Page, title: string): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	return page.url();
}

test('links and unlinks items symmetrically without JavaScript-only controls', async ({ page }) => {
	const firstUrl = await createItem(page, 'Relation First');
	const secondUrl = await createItem(page, 'Relation Second');

	await page.goto(firstUrl);
	await page.getByRole('link', { name: '+ Item verknüpfen' }).click();
	await expect(page).toHaveURL(/manage=relations/);
	await page.getByLabel('Item suchen …').fill('Relation Second');
	await page.getByRole('button', { name: 'Suchen' }).click();
	await page
		.locator('.relation-candidates .related-manage-row', { hasText: 'Relation Second' })
		.getByRole('button', { name: 'Verknüpfen' })
		.click();
	await expect(page).toHaveURL(/manage=relations.*q=relation\+second.*#relations/);
	await expect(page.locator('.related-list--manage', { hasText: 'Relation Second' })).toBeVisible();
	const linkedCandidate = page.locator('.relation-candidates .related-manage-row', {
		hasText: 'Relation Second'
	});
	await expect(linkedCandidate.getByText('Bereits verknüpft')).toBeVisible();
	await expect(linkedCandidate.getByRole('button', { name: 'Verknüpfen' })).toHaveCount(0);
	await page.locator('#relations > details.fields-panel > summary').click();
	await expect(page.getByRole('link', { name: 'Relation Second' })).toBeVisible();
	await page.goto(firstUrl);
	await page.getByRole('link', { name: 'Relation Second' }).click();
	await expect(page).toHaveURL(secondUrl);
	await page.getByRole('link', { name: 'Relation First' }).click();
	await expect(page).toHaveURL(firstUrl);
	await expect(page.getByRole('link', { name: '0 Dokumente' })).toHaveCount(0);
	await expect(page.getByText('Keine Dokumente', { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: '1 verknüpftes Item' })).toHaveAttribute(
		'href',
		'#relations'
	);
	await expect(page.locator('.item-overview__context')).toHaveCSS('display', 'flex');
	await page.getByText('Verknüpfungen verwalten').click();
	await page.getByRole('button', { name: 'Verknüpfung lösen' }).click();
	await expect(page.locator('.related-list--manage')).toHaveCount(0);
	await expect(page.getByText('+ Item verknüpfen')).toBeVisible();
});

test('keeps the add flow open after linking a recent suggestion', async ({ page }) => {
	const sourceUrl = await createItem(page, 'Relation Recent Source');
	await createItem(page, 'Relation Recent Target');

	await page.goto(sourceUrl);
	await page.getByRole('link', { name: '+ Item verknüpfen' }).click();
	await page
		.locator('.relation-candidates .related-manage-row', { hasText: 'Relation Recent Target' })
		.getByRole('button', { name: 'Verknüpfen' })
		.click();

	await expect(page.locator('details.relation-add')).toHaveAttribute('open', '');
	await expect(page.getByLabel('Item suchen …')).toBeVisible();
});

test('highlights normalized title matches across repeated whitespace', async ({ page }) => {
	const sourceUrl = await createItem(page, 'Relation Highlight Source');
	await createItem(page, 'Cafe\u0301   Insurance Policy');

	await page.goto(sourceUrl + '?manage=relations&q=caf%C3%A9+insurance');

	await expect(page.locator('.relation-candidates mark')).toHaveText('Cafe\u0301   Insurance');
});

test('archived items show a document link and a quiet zero-relation count', async ({ page }) => {
	await createItem(page, 'Relation Archive Document');
	await page
		.locator('form[action="?/addAttachment"] input[type="file"]')
		.setInputFiles({ name: 'relation.pdf', mimeType: 'application/pdf', buffer: MINIMAL_PDF });
	await page
		.locator('form[action="?/addAttachment"]')
		.getByRole('button', { name: 'Hinzufügen' })
		.click();
	await page.locator('summary', { hasText: 'Archivieren' }).click();
	await page
		.locator('form[action="?/archiveItem"]')
		.getByRole('button', { name: 'Archivieren' })
		.click();

	await expect(page.getByRole('link', { name: '1 Dokument' })).toHaveAttribute(
		'href',
		'#attachments'
	);
	await expect(page.getByRole('link', { name: '0 verknüpfte Items' })).toHaveCount(0);
	await expect(page.getByText('0 verknüpfte Items', { exact: true })).toBeVisible();
	await expect(page.locator('#relations')).toHaveCount(0);
});

test('shows a quiet no-result state for an unmatched candidate search', async ({ page }) => {
	const itemUrl = await createItem(page, 'Relation Search Source');
	await page.goto(itemUrl + '?manage=relations&q=no+matching+item');

	await expect(page.getByText('Kein Item gefunden.')).toBeVisible();
	await expect(page.locator('.relation-candidates')).toHaveCount(0);
});

test('archived items show relations read-only', async ({ page }) => {
	const firstUrl = await createItem(page, 'Relation Archive First');
	await createItem(page, 'Relation Archive Second');
	await page.goto(firstUrl + '?manage=relations');
	await page.getByLabel('Item suchen …').fill('Relation Archive Second');
	await page.getByRole('button', { name: 'Suchen' }).click();
	await page
		.locator('.relation-candidates .related-manage-row', { hasText: 'Relation Archive Second' })
		.getByRole('button', { name: 'Verknüpfen' })
		.click();
	await page.goto(firstUrl);
	await page.locator('summary', { hasText: 'Archivieren' }).click();
	await page
		.locator('form[action="?/archiveItem"]')
		.getByRole('button', { name: 'Archivieren' })
		.click();
	await expect(page.getByRole('link', { name: /Relation Archive Second/ })).toBeVisible();
	await expect(page.getByText('Verknüpfungen verwalten')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Verknüpfung lösen' })).toHaveCount(0);
});

test('shows five related items before the inline disclosure and fits at 375px', async ({
	page
}) => {
	const itemUrl = await createItem(page, 'Relation Many Current');
	const titles = [
		'Relation Many Alpha',
		'Relation Many Bravo',
		'Relation Many Charlie',
		'Relation Many Delta',
		'Relation Many Echo',
		'Relation Many Foxtrot'
	];
	for (const title of titles) await createItem(page, title);

	await page.goto(itemUrl + '?manage=relations');
	for (const title of titles) {
		await page.getByLabel('Item suchen …').fill(title);
		await page.getByRole('button', { name: 'Suchen' }).click();
		await page
			.locator('.relation-candidates .related-manage-row', { hasText: title })
			.getByRole('button', { name: 'Verknüpfen' })
			.click();
	}

	await page.goto(itemUrl);
	await expect(page.locator('.fields-view > .related-list > .related-row')).toHaveCount(5);
	await page.getByText('Alle 6 anzeigen').click();
	await expect(page.locator('.related-more .related-row').last()).toBeVisible();
	await page.setViewportSize({ width: 375, height: 667 });
	expect(await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(
		true
	);
	await expect(page.locator('.item-overview__context')).toHaveCSS('display', 'flex');
	await expect(page.locator('.related-row').first()).toHaveCSS('min-height', '64px');
	await page.setViewportSize({ width: 640, height: 667 });
	await expect(page.locator('.related-row').first()).toHaveCSS('min-height', '60px');
	await page.goto(itemUrl + '?manage=relations');
	await expect(page.locator('.relation-search__controls')).toHaveCSS('flex-direction', 'row');
	await expect(page.locator('.related-manage-row').first()).toHaveCSS('flex-direction', 'row');
	await page.goto(itemUrl);
	await page.locator('summary', { hasText: 'Archivieren' }).click();
	await page
		.locator('form[action="?/archiveItem"]')
		.getByRole('button', { name: 'Archivieren' })
		.click();
	await expect(page.locator('#relations > .related-list > .related-row')).toHaveCount(5);
	await expect(page.getByText('Alle 6 anzeigen')).toBeVisible();
});

test('relation forms work without JavaScript', async ({ browser }) => {
	const context = await browser.newContext({
		javaScriptEnabled: false,
		storageState: '.data-e2e/playwright-auth.json'
	});
	const page = await context.newPage();
	const firstUrl = await createItem(page, 'Relation No JavaScript First');
	const secondUrl = await createItem(page, 'Relation No JavaScript Second');

	await page.goto(firstUrl);
	await page.getByRole('link', { name: '+ Item verknüpfen' }).click();
	await page.getByLabel('Item suchen …').fill('Relation No JavaScript Second');
	await page.getByRole('button', { name: 'Suchen' }).click();
	await page
		.locator('.relation-candidates .related-manage-row', {
			hasText: 'Relation No JavaScript Second'
		})
		.getByRole('button', { name: 'Verknüpfen' })
		.click();
	await expect(
		page.locator('.related-list--manage .related-row__title', {
			hasText: 'Relation No JavaScript Second'
		})
	).toBeVisible();
	await page.goto(firstUrl);
	await page.getByRole('link', { name: 'Relation No JavaScript Second' }).click();
	await expect(page).toHaveURL(secondUrl);
	await page.goto(firstUrl + '?manage=relations');
	await page.getByRole('button', { name: 'Verknüpfung lösen' }).click();
	await expect(page.locator('.related-list--manage .related-manage-row')).toHaveCount(0);
	await expect(page.getByRole('link', { name: '+ Item verknüpfen' })).toBeVisible();
	await context.close();
});

test('related-item disclosure works without JavaScript', async ({ browser }) => {
	const context = await browser.newContext({
		javaScriptEnabled: false,
		storageState: '.data-e2e/playwright-auth.json'
	});
	const page = await context.newPage();
	const itemUrl = await createItem(page, 'Relation No JavaScript Disclosure Current');
	const titles = [
		'Relation No JavaScript Disclosure Alpha',
		'Relation No JavaScript Disclosure Bravo',
		'Relation No JavaScript Disclosure Charlie',
		'Relation No JavaScript Disclosure Delta',
		'Relation No JavaScript Disclosure Echo',
		'Relation No JavaScript Disclosure Foxtrot'
	];
	for (const title of titles) await createItem(page, title);

	await page.goto(itemUrl + '?manage=relations');
	for (const title of titles) {
		await page.getByLabel('Item suchen …').fill(title);
		await page.getByRole('button', { name: 'Suchen' }).click();
		await page
			.locator('.relation-candidates .related-manage-row', { hasText: title })
			.getByRole('button', { name: 'Verknüpfen' })
			.click();
	}

	await page.goto(itemUrl);
	await page.getByText('Alle 6 anzeigen').click();
	await expect(page.locator('.related-more .related-row').last()).toBeVisible();
	await context.close();
});

test('does not expose related items without an authenticated session', async ({ page }) => {
	const itemUrl = await createItem(page, 'Relation Anonymous');
	await page.context().clearCookies();
	await page.goto(itemUrl);
	await expect(page).toHaveURL(/\/login\?redirectTo=/);
});
