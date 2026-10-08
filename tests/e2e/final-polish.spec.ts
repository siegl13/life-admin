import { expect, test } from '@playwright/test';

const MINIMAL_PDF = Buffer.from('%PDF-1.4\n%%EOF');

function inboxRow(page: import('@playwright/test').Page, filename: string) {
	return page
		.getByRole('listitem')
		.filter({ has: page.getByRole('heading', { name: filename, level: 3 }) });
}

function inboxDetail(page: import('@playwright/test').Page) {
	return page.locator('.inbox-detail');
}

async function uploadInboxDocument(
	page: import('@playwright/test').Page,
	filename: string
): Promise<void> {
	await page.goto('/inbox');
	await page
		.locator('form[action="?/upload"] input[type="file"]')
		.setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: MINIMAL_PDF });
	await page.locator('form[action="?/upload"] button[type="submit"]').click();
	await expect(inboxRow(page, filename)).toBeVisible();
}

async function deleteIfPending(
	page: import('@playwright/test').Page,
	filename: string
): Promise<void> {
	await page.goto('/inbox');
	const row = inboxRow(page, filename);
	if ((await row.count()) === 0) return;
	const documentLink = row.locator('a[href*="/inbox?doc="]');
	if ((await documentLink.count()) > 0) {
		await documentLink.focus();
		await documentLink.press('Enter');
	}
	await expect(inboxDetail(page).getByRole('heading', { name: filename, level: 2 })).toBeVisible();
	const deleteButton = inboxDetail(page).locator('button[formaction="?/delete"]');
	await deleteButton.click();
	await expect(row).toHaveCount(0);
}

test.describe('Final polish: rendered relative time and hydration', () => {
	test('Inbox relative time keeps using server now after the browser clock moves', async ({
		page
	}) => {
		const filename = `final-polish-relative-time-${Date.now()}.pdf`;
		try {
			await uploadInboxDocument(page, filename);
			const meta = inboxRow(page, filename).locator('.inbox-list__meta');
			await expect(meta).toContainText('abgelegt gerade eben');

			// Unit tests cover every time scale boundary. This integration check
			// protects SSR/hydration: moving only the client clock must not change
			// the value computed from the serialized server `now`.
			await page.clock.install({ time: new Date(Date.now() + 10 * 86_400_000) });
			await page.goto('/inbox');
			const refreshedMeta = inboxRow(page, filename).locator('.inbox-list__meta');
			await expect(refreshedMeta).toContainText('abgelegt gerade eben');
			await expect(refreshedMeta).not.toContainText('Tagen');
		} finally {
			await deleteIfPending(page, filename);
		}
	});
});

test.describe('Final polish: shared header and control appearance on Settings, Search and auth pages', () => {
	test('Settings, Search and Login share the same page-head heading structure and 44px control heights', async ({
		page
	}) => {
		const cases = [
			{ route: '/settings', heading: '.page-head h1', controls: '.theme-option' },
			{ route: '/suche', heading: '.search-page h1', controls: '#search-query' },
			{
				route: '/login',
				heading: '.page-head h1',
				controls:
					'.form-panel input[type="text"], .form-panel input[type="password"], .form-panel button[type="submit"]'
			}
		];

		for (const { route, heading: headingSelector, controls: controlSelector } of cases) {
			if (route === '/login') await page.context().clearCookies();
			await page.goto(route);
			const heading = page.locator(headingSelector);
			await expect(heading).toBeVisible();
			await expect(heading).toHaveText(/^[A-ZÄÖÜ][^.]*$/);

			const controls = page.locator(controlSelector);
			const count = await controls.count();
			expect(count).toBeGreaterThan(0);
			for (let i = 0; i < count; i++) {
				const height = await controls
					.nth(i)
					.evaluate((node) => node.getBoundingClientRect().height);
				expect(height).toBeGreaterThanOrEqual(44);
			}
		}
	});
});

test.describe('Final polish: Inbox short list beside a tall detail panel', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('a single pending upload keeps the list sized to its own row, not stretched to a taller detail form', async ({
		page
	}) => {
		const filename = `final-polish-short-list-${Date.now()}.pdf`;
		try {
			await uploadInboxDocument(page, filename);
			await page.goto('/inbox');

			const detail = inboxDetail(page);
			const newDestination = detail.locator('input[name="destination"][value="new"]');
			await newDestination.check();
			await expect(detail.locator('input[name="title"]')).toBeVisible();

			const listBox = await page.locator('.inbox-list').boundingBox();
			const detailBox = await detail.boundingBox();
			expect(listBox).not.toBeNull();
			expect(detailBox).not.toBeNull();
			if (listBox && detailBox) {
				expect(detailBox.height - listBox.height).toBeGreaterThan(200);
			}
		} finally {
			await deleteIfPending(page, filename);
		}
	});
});
