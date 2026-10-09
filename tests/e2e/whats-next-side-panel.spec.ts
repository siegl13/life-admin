import { expect, test, type Page } from '@playwright/test';

test.use({ locale: 'de-DE' });

const MINIMAL_PDF = Buffer.from('%PDF-1.4\n%%EOF');

async function createItem(page: Page, title: string): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	return page.url().split('/').pop()!;
}

async function createItemFromTuvPlaybook(page: Page, title: string): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	return page.url().split('/').pop()!;
}

async function switchLanguage(page: Page, language: 'de' | 'en'): Promise<void> {
	await page.goto('/settings');
	await page.locator(`#g-language form button[value="${language}"]`).click();
	await expect(page.locator('html')).toHaveAttribute('lang', language);
}

async function addAction(page: Page, label: string, dueDate: string): Promise<void> {
	const form = page.locator('form[action="?/addManualAction"]');
	await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
	await form.getByLabel('Bezeichnung der Aufgabe').fill(label);
	await form.getByLabel('Fällig am (optional)').fill(dueDate);
	await form.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
}

function dateInDays(days: number): string {
	const date = new Date();
	date.setDate(date.getDate() + days);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

async function archiveItem(page: Page, id: string): Promise<void> {
	await page.request.post(`/items/${id}?/archiveItem`, {
		form: {},
		headers: { accept: 'text/html', origin: 'http://127.0.0.1:4173' }
	});
}

async function uploadPendingDocument(page: Page, filename: string): Promise<void> {
	await page.goto('/inbox');
	await page
		.locator('form[action="?/upload"] input[type="file"]')
		.setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: MINIMAL_PDF });
	await page.locator('form[action="?/upload"] button[type="submit"]').click();
	await expect(page.getByRole('heading', { name: filename, level: 3 })).toBeVisible();
}

async function deletePendingDocument(page: Page, filename: string): Promise<void> {
	await page.goto('/inbox');
	const row = page
		.getByRole('listitem')
		.filter({ has: page.getByRole('heading', { name: filename, level: 3 }) });
	if (await row.count()) {
		await row.locator('a[href*="/inbox?doc="]').click();
		await page.locator('.inbox-detail').getByRole('button', { name: 'Dokument löschen' }).click();
		await expect(page.getByRole('heading', { name: filename, level: 3 })).toHaveCount(0);
	}
}

test.describe("What's next weekly side panel", () => {
	test('sorts unsorted weekly actions and renders only the first five', async ({ page }) => {
		const ids: string[] = [];
		const titlePrefix = `Weekly panel ${Date.now()}`;
		try {
			const titles = Array.from({ length: 7 }, (_, index) => `${titlePrefix} ${6 - index}`);
			const now = new Date();
			const daysThroughSunday = (7 - now.getDay()) % 7;
			const offsets = [
				Math.min(4, daysThroughSunday),
				Math.min(1, daysThroughSunday),
				Math.min(3, daysThroughSunday),
				0,
				Math.min(2, daysThroughSunday),
				Math.min(5, daysThroughSunday),
				Math.min(4, daysThroughSunday)
			];
			const fixtures: { title: string; id: string; action: string; date: string }[] = [];
			for (const [index, title] of titles.entries()) {
				const id = await createItem(page, title);
				ids.push(id);
				const action = `Weekly task ${index + 1}`;
				const date = dateInDays(offsets[index]);
				await addAction(page, action, date);
				fixtures.push({ title, id, action, date });
			}
			const expected = [...fixtures]
				.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
				.slice(0, 5);

			await page.goto('/');
			await page.setViewportSize({ width: 1440, height: 1000 });
			const panel = page.locator('.whats-next-panel');
			const main = page.locator('.whats-next-main');
			const container = page.locator('.app-shell');
			await expect(panel).toBeVisible();
			const panelBox = await panel.boundingBox();
			const mainBox = await main.boundingBox();
			expect(panelBox).not.toBeNull();
			expect(mainBox).not.toBeNull();
			expect(panelBox!.x).toBeGreaterThan(mainBox!.x + mainBox!.width - 1);

			const rows = panel.locator('.whats-next-week-list li');
			await expect(rows).toHaveCount(5);
			for (let index = 0; index < expected.length; index++) {
				const row = rows.nth(index);
				await expect(row.locator('time')).toHaveAttribute('datetime', expected[index].date);
				const expectedDate =
					expected[index].date === dateInDays(0)
						? 'Heute'
						: new Intl.DateTimeFormat('de-DE', {
								weekday: 'short',
								day: 'numeric',
								month: 'short',
								timeZone: 'UTC'
							})
								.format(new Date(`${expected[index].date}T00:00:00Z`))
								.replace(',', '');
				await expect(row.locator('time')).toHaveText(expectedDate);
				await expect(row.locator('.whats-next-week-list__action')).toHaveText(
					expected[index].action
				);
				const itemLink = row.getByRole('link');
				await expect(itemLink).toHaveAttribute('href', new RegExp(`/items/${expected[index].id}$`));
				await expect(itemLink).toHaveAttribute(
					'title',
					`${expectedDate} · ${expected[index].action}`
				);
				await expect(itemLink).toHaveCSS('min-height', '44px');
				await expect(itemLink).not.toContainText(expected[index].title);
			}
			await expect(panel.getByText('+2 weitere Aufgaben', { exact: true })).toBeVisible();
			await switchLanguage(page, 'en');
			await page.goto('/');
			await expect(
				page.locator('.whats-next-panel').getByText('+2 more tasks', { exact: true })
			).toBeVisible();
			await switchLanguage(page, 'de');
			await page.goto('/');
			const upcomingLink = panel.getByRole('link', { name: 'Demnächst' });
			await expect(upcomingLink).toHaveAttribute('href', '/upcoming');
			await upcomingLink.click();
			await expect(page).toHaveURL('/upcoming');
			await expect(page.locator('.upcoming-ranges')).toBeVisible();
			await page.goto('/');
			await panel.getByRole('link', { name: new RegExp(expected[0].action) }).click();
			await expect(page).toHaveURL(`/items/${expected[0].id}`);
			await expect(page.getByRole('heading', { name: expected[0].title })).toBeVisible();

			await page.goto('/');
			await container.evaluate((element) => {
				const shell = element as HTMLElement;
				shell.style.flex = '0 0 55rem';
				shell.style.width = '55rem';
				shell.style.maxWidth = 'none';
			});
			const stackedPanelBox = await panel.boundingBox();
			const stackedMainBox = await main.boundingBox();
			expect(stackedPanelBox!.y).toBeGreaterThanOrEqual(stackedMainBox!.y + stackedMainBox!.height);

			await container.evaluate((element) => element.removeAttribute('style'));
			await page.setViewportSize({ width: 390, height: 844 });
			await expect(panel).toBeHidden();
		} finally {
			for (const id of ids) await archiveItem(page, id);
		}
	});

	test('includes today and Sunday, but independently excludes Monday, non-OPEN actions, and unresolved derived dates', async ({
		page
	}) => {
		const ids: string[] = [];
		const prefix = `Weekly boundary ${Date.now()}`;
		const fixtures = [
			{ title: `${prefix} today`, action: 'Eligible today', offset: 0 },
			{
				title: `${prefix} Sunday`,
				action: 'Eligible Sunday',
				offset: (7 - new Date().getDay()) % 7
			},
			{
				title: `${prefix} Monday`,
				action: 'Excluded Monday',
				offset: ((7 - new Date().getDay()) % 7) + 1
			},
			{ title: `${prefix} done`, action: 'Excluded done', offset: 1 },
			{ title: `${prefix} skipped`, action: 'Excluded skipped', offset: 1 }
		];
		try {
			for (const fixture of fixtures) {
				const id = await createItem(page, fixture.title);
				ids.push(id);
				await addAction(page, fixture.action, dateInDays(fixture.offset));
			}
			const unresolvedTitle = `${prefix} unresolved derived`;
			const unresolvedId = await createItemFromTuvPlaybook(page, unresolvedTitle);
			ids.push(unresolvedId);

			await page.goto('/');
			const doneGroup = page.locator('.item-group', { hasText: fixtures[3].title });
			await doneGroup.getByRole('button', { name: 'Erledigen: Excluded done' }).click();
			const skippedGroup = page.locator('.item-group', { hasText: fixtures[4].title });
			await skippedGroup.locator('summary').click();
			await skippedGroup.getByRole('button', { name: 'Überspringen' }).click();

			await page.goto('/');
			const panel = page.locator('.whats-next-panel');
			const rows = panel.locator('.whats-next-week-list li');
			const expected = fixtures
				.slice(0, 2)
				.sort(
					(a, b) =>
						dateInDays(a.offset).localeCompare(dateInDays(b.offset)) ||
						a.title.localeCompare(b.title)
				);
			await expect(rows).toHaveCount(2);
			for (let index = 0; index < expected.length; index++) {
				const row = rows.nth(index);
				await expect(row.locator('time')).toHaveAttribute(
					'datetime',
					dateInDays(expected[index].offset)
				);
				await expect(row.locator('.whats-next-week-list__action')).toHaveText(
					expected[index].action
				);
				if (expected[index].offset === 0) await expect(row.locator('time')).toHaveText('Heute');
			}
			for (const fixture of fixtures.slice(2)) {
				await expect(panel.getByRole('link', { name: fixture.title, exact: true })).toHaveCount(0);
			}
			await expect(panel.getByRole('link', { name: unresolvedTitle, exact: true })).toHaveCount(0);
		} finally {
			for (const id of ids) await archiveItem(page, id);
		}
	});

	test('ellipsizes long weekly action titles and exposes the full title without page overflow', async ({
		page
	}) => {
		const title = `Weekly long title ${Date.now()}`;
		const id = await createItem(page, title);
		const longAction =
			'A deliberately long weekly action title with enough words to be truncated inside the side panel';
		try {
			await addAction(page, longAction, dateInDays(0));
			await page.setViewportSize({ width: 1440, height: 1000 });
			await page.goto('/');
			const itemLink = page.locator('.whats-next-panel .whats-next-week-list a', {
				hasText: longAction
			});
			await expect(itemLink).toBeVisible();
			await expect(itemLink).toHaveAttribute('title', `Heute · ${longAction}`);
			const actionText = itemLink.locator('.whats-next-week-list__action');
			const layout = await actionText.evaluate((element) => ({
				clientWidth: element.clientWidth,
				scrollWidth: element.scrollWidth,
				textOverflow: getComputedStyle(element).textOverflow,
				whiteSpace: getComputedStyle(element).whiteSpace
			}));
			expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
			expect(layout.textOverflow).toBe('ellipsis');
			expect(layout.whiteSpace).toBe('nowrap');
			await expect
				.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= 1440))
				.toBe(true);
		} finally {
			await archiveItem(page, id);
		}
	});

	test('shows a localized empty week and hides the Inbox card at zero documents', async ({
		page
	}) => {
		try {
			await switchLanguage(page, 'en');
			await page.goto('/');
			await expect(page.locator('html')).toHaveAttribute('lang', 'en');
			await expect(page.getByText('Nothing this week.', { exact: true })).toBeVisible();
			await expect(page.locator('#inbox-overview-title')).toHaveCount(0);
		} finally {
			await switchLanguage(page, 'de');
		}
	});

	test('shows localized singular/plural pending Inbox counts and links to Inbox', async ({
		page
	}) => {
		const timestamp = Date.now();
		const names = [`weekly-panel-${timestamp}-one.pdf`, `weekly-panel-${timestamp}-two.pdf`];
		const uploaded: string[] = [];
		try {
			await switchLanguage(page, 'de');
			await uploadPendingDocument(page, names[0]);
			uploaded.push(names[0]);
			await page.goto('/');
			const inboxLink = page.locator('.whats-next-inbox-link');
			await expect(inboxLink).toHaveText('1 offenes Dokument');
			await expect(inboxLink).toHaveAttribute('href', /\/inbox$/);

			await switchLanguage(page, 'en');
			await page.goto('/');
			await expect(page.locator('.whats-next-inbox-link')).toHaveText('1 pending document');
			await page.locator('.whats-next-inbox-link').click();
			await expect(page).toHaveURL('/inbox');
			await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();

			await uploadPendingDocument(page, names[1]);
			uploaded.push(names[1]);
			await page.goto('/');
			await expect(page.locator('.whats-next-inbox-link')).toHaveText('2 pending documents');

			await switchLanguage(page, 'de');
			await page.goto('/');
			await expect(page.locator('.whats-next-inbox-link')).toHaveText('2 offene Dokumente');
		} finally {
			await switchLanguage(page, 'de');
			for (const name of uploaded) await deletePendingDocument(page, name);
		}
	});
});
