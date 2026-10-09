import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the shell itself: desktop sidebar, mobile header/tabbar/FAB,
 * reachable logout controls, and the two-layout breakpoint. Session
 * invalidation on logout is covered once, in logout.spec.ts — this file
 * only checks that the controls exist and redirect correctly.
 *
 * Every test that actually submits the sign-out form logs in a fresh,
 * independent session first (`loginFresh`, mirroring logout.spec.ts). A
 * real logout invalidates the session server-side, not just the cookie —
 * running it against the shared `storageState` session that every other
 * spec file reuses would sign every later test out too.
 */

const MINIMAL_PDF = Buffer.from('%PDF-1.4\n%%EOF');
const OWNER_USERNAME = 'owner';
const OWNER_PASSWORD = 'correct horse battery staple';

async function loginFresh(page: Page): Promise<void> {
	await page.goto('/login');
	await page.getByLabel('Benutzername').fill(OWNER_USERNAME);
	await page.getByLabel('Passwort').fill(OWNER_PASSWORD);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).toHaveURL('/');
}

async function createItem(page: Page, title: string, playbookLabel?: string): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	if (playbookLabel) {
		await page.getByLabel('Vorlage').selectOption({ label: playbookLabel });
	}
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	return page.url();
}

async function uploadInboxDocument(page: Page, filename: string): Promise<void> {
	await page.goto('/inbox');
	await page
		.locator('form[action="?/upload"] input[type="file"]')
		.setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: MINIMAL_PDF });
	await page
		.locator('form[action="?/upload"]')
		.getByRole('button', { name: 'In Eingang ablegen' })
		.click();
	await expect(page.getByRole('heading', { name: filename, level: 2 })).toBeVisible();
}

// Opening one disclosure can reveal another nested one (e.g. a
// notification channel inside the settings page), so this keeps opening
// the first still-closed one until none are left.
async function openAllDisclosures(page: Page): Promise<void> {
	for (let guard = 0; guard < 20; guard += 1) {
		const closed = page.locator('details:not([open])');
		let visibleSummary = null;
		for (const detail of await closed.all()) {
			const summary = detail.locator(':scope > summary');
			if (await summary.isVisible()) {
				visibleSummary = summary;
				break;
			}
		}
		// Nested disclosures inside another closed/hidden section are not
		// reachable yet. Open only a visible parent, then discover children.
		if (!visibleSummary) return;
		await visibleSummary.click();
	}
}

function rectsOverlap(
	a: { x: number; y: number; width: number; height: number },
	b: { x: number; y: number; width: number; height: number }
): boolean {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// A rectangle check alone can pass even though the fixed tab bar or
// create button is the actual top-most element at a control's center
// (e.g. a stacking-order surprise plain geometry can't catch). This
// confirms the browser would really deliver a click to the floating
// control instead of the page's own field — the specific failure this
// whole test guards against — rather than flagging unrelated sibling
// elements on the page as "obscuring" each other.
async function assertNotObscuredByFloatingControls(
	control: ReturnType<Page['locator']>,
	box: { x: number; y: number; width: number; height: number }
): Promise<void> {
	const obscured = await control.page().evaluate(
		({ cx, cy }) => {
			const top = document.elementFromPoint(cx, cy);
			return !!top && !!(top.closest('.app-tabbar') || top.closest('.app-fab'));
		},
		{ cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
	);
	expect(obscured, 'a floating control must not intercept the click meant for this field').toBe(
		false
	);
}

// Checks every visible field and submit control in the main content, each
// scrolled into view the way a real user would reach it, plus the fully
// scrolled-to-bottom position — against both fixed controls, with both a
// geometric overlap check and a real hit-test at each control's center.
async function assertNoFloatingOverlap(page: Page): Promise<void> {
	const tabbar = page.locator('.app-tabbar');
	const fab = page.locator('.app-fab');
	const controls = page.locator('main :is(input, select, textarea, button):visible');
	const count = await controls.count();
	expect(count, 'the page must expose at least one field or submit control').toBeGreaterThan(0);

	async function assertControlClear(
		control: ReturnType<Page['locator']>,
		box: { x: number; y: number; width: number; height: number }
	) {
		if ((await tabbar.count()) > 0) {
			const tabbarBox = await tabbar.boundingBox();
			if (tabbarBox) expect(rectsOverlap(box, tabbarBox)).toBe(false);
		}
		if ((await fab.count()) > 0 && (await fab.isVisible())) {
			const fabBox = await fab.boundingBox();
			if (fabBox) expect(rectsOverlap(box, fabBox)).toBe(false);
		}
		await assertNotObscuredByFloatingControls(control, box);
	}

	for (let index = 0; index < count; index += 1) {
		const control = controls.nth(index);
		await control.scrollIntoViewIfNeeded();
		const box = await control.boundingBox();
		if (box) await assertControlClear(control, box);
	}

	// An explicit full-page bottom scroll: every control still visible
	// there must clear the fixed bar and button, not just the one that
	// happened to be last in the DOM.
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	for (let index = 0; index < count; index += 1) {
		const control = controls.nth(index);
		if (!(await control.isVisible())) continue;
		const box = await control.boundingBox();
		if (box) await assertControlClear(control, box);
	}
}

test.describe('desktop sidebar', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('shows brand, search link, four destinations, create, settings and sign-out', async ({
		page
	}) => {
		await page.goto('/');
		await expect(page.getByRole('link', { name: 'Life Admin' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Suchen' })).toBeVisible();

		const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
		await expect(nav.getByRole('link', { name: 'Was steht an' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(nav.getByRole('link', { name: 'Demnächst' })).toBeVisible();
		await expect(nav.getByRole('link', { name: 'Elemente' })).toBeVisible();
		await expect(nav.getByRole('link', { name: 'Eingang' })).toBeVisible();

		// Scoped to the sidebar: the page content itself also has its own
		// "Neues Element" call to action, which would otherwise make this
		// an ambiguous, strict-mode-violating query.
		await expect(
			page.locator('.app-sidebar').getByRole('link', { name: 'Neues Element' })
		).toBeVisible();
		await expect(
			page.locator('.app-sidebar').getByRole('link', { name: 'Einstellungen' })
		).toBeVisible();
		await expect(
			page.locator('.app-sidebar').getByRole('button', { name: 'Abmelden' })
		).toBeVisible();
	});

	test('active destination follows the current route', async ({ page }) => {
		await page.goto('/upcoming');
		const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
		await expect(nav.getByRole('link', { name: 'Demnächst' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(nav.getByRole('link', { name: 'Was steht an' })).not.toHaveAttribute(
			'aria-current',
			'page'
		);
	});

	test('clicking each sidebar destination navigates and updates the active state', async ({
		page
	}) => {
		await page.goto('/');
		const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
		const journey: Array<[string, string]> = [
			['Demnächst', '/upcoming'],
			['Elemente', '/items'],
			['Eingang', '/inbox'],
			['Was steht an', '/']
		];
		for (const [label, url] of journey) {
			await nav.getByRole('link', { name: label }).click();
			await expect(page).toHaveURL(url);
			await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
		}
	});

	test('sidebar Settings link navigates to Settings', async ({ page }) => {
		await page.goto('/');
		await page.locator('.app-sidebar').getByRole('link', { name: 'Einstellungen' }).click();
		await expect(page).toHaveURL('/settings');
	});

	test('search link reaches the search page', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('link', { name: 'Suchen' }).click();
		await expect(page).toHaveURL('/suche');
	});

	test('create link reaches the new-item form', async ({ page }) => {
		await page.goto('/');
		await page.locator('.app-sidebar').getByRole('link', { name: 'Neues Element' }).click();
		await expect(page).toHaveURL('/items/new');
	});

	test('sidebar controls keep a 44px touch target', async ({ page }) => {
		await page.goto('/');
		const targets = page.locator('.app-sidebar a, .app-sidebar button');
		const count = await targets.count();
		expect(count).toBeGreaterThan(0);
		for (let index = 0; index < count; index += 1) {
			const box = await targets.nth(index).boundingBox();
			if (box) expect(box.height).toBeGreaterThanOrEqual(44);
		}
	});

	test('sidebar reaches the document bottom on a page taller than the viewport', async ({
		page
	}) => {
		await page.goto('/settings');
		await page.evaluate(() => document.fonts.ready);
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

		const bounds = await page.locator('.app-sidebar').evaluate((sidebar) => ({
			sidebarBottom: sidebar.getBoundingClientRect().bottom + window.scrollY,
			documentBottom: document.documentElement.scrollHeight,
			viewportHeight: window.innerHeight,
			scrollY: window.scrollY
		}));
		expect(bounds.documentBottom).toBeGreaterThan(bounds.viewportHeight);
		expect(bounds.scrollY).toBeGreaterThan(0);
		expect(bounds.sidebarBottom).toBeGreaterThanOrEqual(bounds.documentBottom - 1);
		await expect(page.locator('.app-sidebar')).toHaveCSS('position', 'static');
		await expect(
			page.locator('.app-sidebar').getByRole('button', { name: 'Abmelden' })
		).toBeInViewport();
	});
});

test.describe('content column is centered in the area right of the sidebar on wide screens', () => {
	const listRoutes = ['/upcoming', '/items', '/suche', '/settings'];
	const LIST_MAX = 60 * 16; // 960px

	for (const width of [390, 768, 1280, 1440, 1920, 2560]) {
		test(`list pages center their 60rem container at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });

			for (const route of listRoutes) {
				await page.goto(route);
				const layout = await page.evaluate(() => {
					const sidebar = document.querySelector('.app-sidebar');
					const container = document.querySelector('.page-container--list');
					if (!container) return null;
					const containerRect = container.getBoundingClientRect();
					// The content area right of the sidebar, not the shell itself:
					// a left-aligned `.app-shell` (e.g. `margin: 0`) would still pass
					// a shell-relative check while visibly hugging the sidebar.
					const areaLeft = sidebar ? sidebar.getBoundingClientRect().right : 0;
					const areaRight = window.innerWidth;
					return {
						areaLeft,
						areaRight,
						containerLeft: containerRect.left,
						containerRight: containerRect.right,
						containerWidth: containerRect.width
					};
				});
				expect(layout).not.toBeNull();
				// The 60rem list-page-container variant, not a page-specific width.
				expect(layout!.containerWidth).toBeLessThanOrEqual(961);
				// Centered relative to the sidebar-to-viewport-edge area (desktop
				// sidebar present at >=768px), not just inside whatever box the
				// shell itself occupies.
				if (width >= 768) {
					const leftGap = layout!.containerLeft - layout!.areaLeft;
					const rightGap = layout!.areaRight - layout!.containerRight;
					expect(Math.abs(leftGap - rightGap)).toBeLessThan(2);
				}
				// Once the sidebar-to-viewport-edge area is wide enough, the
				// container actually reaches the 60rem cap, not just "narrower
				// than 961px" (which an unrelated, smaller width would also satisfy).
				const areaWidth = layout!.areaRight - layout!.areaLeft;
				if (areaWidth >= LIST_MAX + 64) {
					expect(layout!.containerWidth).toBeGreaterThanOrEqual(LIST_MAX - 1);
				}
			}
		});
	}
});

test.describe('item detail uses the 77.5rem wide page-container variant', () => {
	test('Item detail and Inbox use the centered 77.5rem wide variant', async ({ page }) => {
		await page.setViewportSize({ width: 1920, height: 900 });
		await page.goto('/items/new');
		await page.getByLabel('Titel').fill(`Wide layout check ${Date.now()}`);
		await page.getByRole('button', { name: 'Anlegen' }).click();
		await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
		const itemUrl = page.url();
		const itemId = itemUrl.split('/').pop()!;

		for (const route of [itemUrl, '/inbox']) {
			await page.goto(route);
			const layout = await page.evaluate(() => {
				const sidebar = document.querySelector('.app-sidebar');
				const container = document.querySelector('.page-container--wide');
				if (!sidebar || !container) return null;
				const containerRect = container.getBoundingClientRect();
				const areaLeft = sidebar.getBoundingClientRect().right;
				const areaRight = window.innerWidth;
				return {
					leftGap: containerRect.left - areaLeft,
					rightGap: areaRight - containerRect.right,
					containerWidth: containerRect.width
				};
			});
			expect(layout).not.toBeNull();
			expect(layout!.containerWidth).toBeGreaterThan(961);
			expect(layout!.containerWidth).toBeLessThanOrEqual(77.5 * 16 + 1);
			// At 1920px, 77.5rem (1240px) comfortably fits the sidebar-to-
			// viewport-edge area, so the container both reaches the cap and is
			// centered within that area, not just within the shell box.
			expect(layout!.containerWidth).toBeGreaterThanOrEqual(77.5 * 16 - 1);
			expect(Math.abs(layout!.leftGap - layout!.rightGap)).toBeLessThan(2);
		}
		await page.request.post(`/items/${itemId}?/archiveItem`, {
			form: {},
			headers: { accept: 'text/html', origin: new URL(page.url()).origin }
		});
	});
});

test.describe('mobile shell', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('shows four tabs and a floating create button, not settings or sign-out', async ({
		page
	}) => {
		await page.goto('/');
		const tabbar = page.getByRole('navigation', { name: 'Navigation' });
		await expect(tabbar.getByRole('link', { name: 'Was steht an' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(tabbar.getByRole('link', { name: 'Demnächst' })).toBeVisible();
		await expect(tabbar.getByRole('link', { name: 'Elemente' })).toBeVisible();
		await expect(tabbar.getByRole('link', { name: 'Eingang' })).toBeVisible();
		await expect(tabbar.getByRole('link', { name: 'Einstellungen' })).toHaveCount(0);

		// The page content has its own "Neues Element" link too, so this is
		// scoped to the floating create button specifically.
		await expect(page.locator('.app-fab')).toBeVisible();
	});

	test('tapping each tab navigates and updates the active state, and the FAB reaches the new-item form', async ({
		page
	}) => {
		await page.goto('/');
		const tabbar = page.getByRole('navigation', { name: 'Navigation' });
		const journey: Array<[string, string]> = [
			['Demnächst', '/upcoming'],
			['Elemente', '/items'],
			['Eingang', '/inbox'],
			['Was steht an', '/']
		];
		for (const [label, url] of journey) {
			await tabbar.getByRole('link', { name: label }).click();
			await expect(page).toHaveURL(url);
			await expect(tabbar.getByRole('link', { name: label })).toHaveAttribute(
				'aria-current',
				'page'
			);
		}

		await page.locator('.app-fab').click();
		await expect(page).toHaveURL('/items/new');
	});

	test('floating create button is hidden on the new-item form', async ({ page }) => {
		await page.goto('/items/new');
		await expect(page.locator('.app-fab')).toHaveCount(0);
	});

	test('shows a brand link and a direct settings link in the header', async ({ page }) => {
		await page.goto('/');
		const header = page.locator('.app-mobile-header');
		await expect(header.getByRole('link', { name: 'Life Admin' })).toBeVisible();
		await expect(header.getByRole('link', { name: 'Einstellungen' })).toBeVisible();
	});

	// Only checks that the menu exposes its controls — it does not submit
	// the sign-out form, so the shared session stays valid. The actual
	// submit-and-redirect is covered under "reachable and successful
	// logout" below, with its own fresh session.
	test('account menu exposes settings and a sign-out form', async ({ page }) => {
		await page.goto('/');
		const menu = page.locator('.app-account-menu');
		await menu.locator('summary').click();
		await expect(menu.getByRole('link', { name: 'Einstellungen' })).toBeVisible();
		await expect(menu.locator('form[action="/logout"]')).toHaveAttribute('method', 'POST');
		await expect(menu.getByRole('button', { name: 'Abmelden' })).toBeVisible();
	});

	test('mobile controls keep a 44px touch target', async ({ page }) => {
		await page.goto('/');
		const targets = page.locator(
			'.app-mobile-header a, .app-mobile-header summary, .app-tabbar a, .app-fab'
		);
		const count = await targets.count();
		expect(count).toBeGreaterThan(0);
		for (let index = 0; index < count; index += 1) {
			const box = await targets.nth(index).boundingBox();
			if (box) {
				expect(box.width).toBeGreaterThanOrEqual(44);
				expect(box.height).toBeGreaterThanOrEqual(44);
			}
		}
	});

	test('"Was steht an" does not wrap at 375px', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 844 });
		await page.goto('/');
		const label = page
			.getByRole('navigation', { name: 'Navigation' })
			.getByRole('link', { name: 'Was steht an' })
			.locator('span');
		await expect(label).toBeVisible();
		const box = await label.boundingBox();
		const lineHeight = await label.evaluate((el) =>
			parseFloat(getComputedStyle(el as Element).lineHeight)
		);
		expect(box, 'the label text must have a measurable box').not.toBeNull();
		// A wrapped label spans two lines, which is close to 2x lineHeight;
		// a single line stays well under 1.5x even with sub-pixel rounding.
		expect(box!.height).toBeLessThan(lineHeight * 1.5);
	});
});

test.describe('reachable and successful logout', () => {
	// Starts with no stored session: each test logs in fresh so its logout
	// invalidates only its own session, never the shared one.
	test.use({ storageState: { cookies: [], origins: [] } });

	test('desktop sidebar signs out and redirects to login', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await loginFresh(page);
		await page.locator('.app-sidebar').getByRole('button', { name: 'Abmelden' }).click();
		await expect(page).toHaveURL('/login');
	});

	test('mobile account menu signs out and redirects to login', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await loginFresh(page);
		const menu = page.locator('.app-account-menu');
		await menu.locator('summary').click();
		await menu.getByRole('button', { name: 'Abmelden' }).click();
		await expect(page).toHaveURL('/login');
	});
});

test('no horizontal overflow and a single layout at the 768px boundary', async ({ page }) => {
	await page.goto('/');
	for (const width of [375, 767, 768]) {
		await page.setViewportSize({ width, height: 800 });
		expect(
			await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth),
			`page must not overflow at ${width}px`
		).toBe(true);
	}

	await page.setViewportSize({ width: 767, height: 800 });
	await expect(page.locator('.app-sidebar')).toBeHidden();
	await expect(page.locator('.app-mobile-header')).toBeVisible();

	await page.setViewportSize({ width: 768, height: 800 });
	await expect(page.locator('.app-sidebar')).toBeVisible();
	await expect(page.locator('.app-mobile-header')).toBeHidden();
});

test('skip link moves focus to the main content', async ({ page }) => {
	await page.goto('/');
	await page.keyboard.press('Tab');
	await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.locator('#main')).toBeFocused();
});

test.describe('navigation and sign-out work without JavaScript', () => {
	test.use({ javaScriptEnabled: false, storageState: { cookies: [], origins: [] } });

	test('desktop sidebar navigates and signs out with plain links and a POST form', async ({
		page
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await loginFresh(page);
		await page.locator('.app-sidebar').getByRole('link', { name: 'Demnächst' }).click();
		await expect(page).toHaveURL('/upcoming');
		await page.locator('.app-sidebar').getByRole('button', { name: 'Abmelden' }).click();
		await expect(page).toHaveURL('/login');
	});

	test('mobile tabbar navigates and the account menu signs out', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await loginFresh(page);
		await page
			.getByRole('navigation', { name: 'Navigation' })
			.getByRole('link', { name: 'Elemente' })
			.click();
		await expect(page).toHaveURL('/items');

		const menu = page.locator('.app-account-menu');
		await menu.locator('summary').click();
		await menu.getByRole('button', { name: 'Abmelden' }).click();
		await expect(page).toHaveURL('/login');
	});
});

test.describe('floating controls never cover a form field or submit button', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('new-item form', async ({ page }) => {
		await page.goto('/items/new');
		await assertNoFloatingOverlap(page);
	});

	test('settings page', async ({ page }) => {
		await page.goto('/settings');
		await openAllDisclosures(page);
		await assertNoFloatingOverlap(page);
	});

	test('item detail page', async ({ page }) => {
		// A playbook-backed item (not a bare title-only one) so the page
		// actually renders a populated fields editor and a live workflow
		// action — the forms most likely to sit near the bottom of the
		// page and clash with the floating controls.
		await createItem(page, 'Shell Overlap Test', 'TÜV / Hauptuntersuchung');
		// A fresh TÜV item has no open task until its inspection date is
		// set — fill it so the "Erledigen"/"Überspringen" workflow form
		// actually renders, same as tuv-flow.spec.ts.
		await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
		await page.getByLabel('Nächste HU').fill('2099-01-15');
		await page.getByRole('button', { name: 'Speichern' }).click();
		// The same action also appears in the workflow timeline list, so
		// this is scoped to the primary "next up" card specifically.
		await expect(page.getByRole('button', { name: 'Erledigen' }).first()).toBeVisible();
		await openAllDisclosures(page);
		await expect(page.getByLabel('Nächste HU')).toBeVisible();
		await assertNoFloatingOverlap(page);
	});

	test('inbox page', async ({ page }) => {
		await uploadInboxDocument(page, 'shell-overlap-test.pdf');
		await openAllDisclosures(page);
		await assertNoFloatingOverlap(page);

		// The unselected destination's fields are hidden by CSS until its
		// radio is checked (see inbox/+page.svelte's :has() rule) — switch
		// to the other one so its fields are exercised too, not just
		// whichever destination happened to default to checked.
		const existingRadio = page.getByLabel('Zu einem bestehenden Element');
		const newRadio = page.getByLabel('Als neues Element anlegen');
		const otherRadio = (await existingRadio.isChecked()) ? newRadio : existingRadio;
		await otherRadio.check();
		await assertNoFloatingOverlap(page);

		// The inbox is shared across the whole suite (one DB for the full
		// run) — leaving this document pending would break later specs
		// that assert an empty inbox (e.g. inbox.spec.ts).
		await page.getByRole('button', { name: 'Dokument löschen' }).click();
		await expect(page.getByRole('heading', { name: 'shell-overlap-test.pdf' })).toHaveCount(0);
	});
});
