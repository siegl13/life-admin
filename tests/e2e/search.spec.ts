import { expect, test } from '@playwright/test';

test('Search uses the shareable GET route and can reset the current query', async ({ page }) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Stromvertrag München');
	await page.getByRole('button', { name: 'Anlegen' }).click();

	await page.goto('/suche?q=München');
	await expect(page.getByRole('heading', { name: 'Suche' })).toBeVisible();
	const result = page.getByRole('link', { name: /Stromvertrag München/ });
	await expect(result).toBeVisible();
	await expect(result).toHaveAttribute('href', /\/items\//);
	await result.click();
	await expect(page).toHaveURL(/\/items\//);

	await page.goto('/suche?q=München');
	await expect(page.getByRole('button', { name: 'Suche zurücksetzen' })).toBeVisible();

	await page.getByRole('button', { name: 'Suche zurücksetzen' }).click();
	await expect(page).toHaveURL(/\/suche$/);
	await expect(page.getByLabel('Suchbegriff')).toBeFocused();
});

test('Search retains loaded results during a delayed request and ignores its stale response', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Alter Alpha Treffer');
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Neuer Beta Treffer');
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await page.goto('/suche?q=alter');
	const input = page.getByLabel('Suchbegriff');
	await expect(page.getByRole('link', { name: /Alter Alpha Treffer/ })).toBeVisible();

	let releaseOldRequest!: () => void;
	const oldRequestReleased = new Promise<void>((resolve) => (releaseOldRequest = resolve));
	let oldRequestStarted!: () => void;
	const oldRequest = new Promise<void>((resolve) => (oldRequestStarted = resolve));
	let releaseNewRequest!: () => void;
	const newRequestReleased = new Promise<void>((resolve) => (releaseNewRequest = resolve));
	let newRequestStarted!: () => void;
	const newRequest = new Promise<void>((resolve) => (newRequestStarted = resolve));
	await page.route('**/suche**', async (route) => {
		const query = new URL(route.request().url()).searchParams.get('q');
		if (query === 'alpha') {
			oldRequestStarted();
			await oldRequestReleased;
		}
		if (query === 'beta') {
			newRequestStarted();
			await newRequestReleased;
		}
		await route.continue();
	});

	try {
		await input.fill('Alpha');
		await oldRequest;
		await input.evaluate((element) => {
			const searchInput = element as HTMLInputElement;
			searchInput.value = 'Beta';
			searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
		});
		releaseOldRequest();
		await expect(page).toHaveURL(/\/suche\?q=alpha/);
		await expect(input).toHaveValue('Beta');
		await expect(page.getByRole('link', { name: /Alter Alpha Treffer/ })).toBeVisible();

		await newRequest;
		await expect(page.getByText('Suche läuft …')).toBeVisible();
		releaseNewRequest();
		await expect(page).toHaveURL(/\/suche\?q=beta/);
		await expect(input).toHaveValue('beta');
		await expect(page.getByRole('link', { name: /Neuer Beta Treffer/ })).toBeVisible();
		await expect(page.getByRole('link', { name: /Alter Alpha Treffer/ })).toBeHidden();
	} finally {
		releaseNewRequest();
		releaseOldRequest();
	}
});

test('Search ignores an older response that arrives after a newer result', async ({ page }) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Later Alpha Result');
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Later Beta Result');
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await page.goto('/suche?q=later');
	const input = page.getByLabel('Suchbegriff');
	await expect(page.getByRole('link', { name: /Later Alpha Result/ })).toBeVisible();

	let releaseOldRequest!: () => void;
	const oldRequestReleased = new Promise<void>((resolve) => (releaseOldRequest = resolve));
	let oldRequestStarted!: () => void;
	const oldRequest = new Promise<void>((resolve) => (oldRequestStarted = resolve));
	let releaseNewRequest!: () => void;
	const newRequestReleased = new Promise<void>((resolve) => (releaseNewRequest = resolve));
	let newRequestStarted!: () => void;
	const newRequest = new Promise<void>((resolve) => (newRequestStarted = resolve));
	await page.route('**/suche**', async (route) => {
		const query = new URL(route.request().url()).searchParams.get('q');
		if (query === 'alpha') {
			oldRequestStarted();
			await oldRequestReleased;
		}
		if (query === 'beta') {
			newRequestStarted();
			await newRequestReleased;
		}
		await route.continue();
	});

	try {
		await input.fill('Alpha');
		await oldRequest;
		await input.fill('Beta');
		await newRequest;
		releaseNewRequest();
		await expect(page).toHaveURL(/\/suche\?q=beta/);
		await expect(input).toHaveValue('beta');
		await expect(page.getByRole('link', { name: /Later Beta Result/ })).toBeVisible();

		releaseOldRequest();
		await expect(page).toHaveURL(/\/suche\?q=beta/);
		await expect(input).toHaveValue('beta');
		await expect(page.getByRole('link', { name: /Later Beta Result/ })).toBeVisible();
		await expect(page.getByRole('link', { name: /Later Alpha Result/ })).toBeHidden();
	} finally {
		releaseNewRequest();
		releaseOldRequest();
	}
});

test('Search shows its cap notice for more than 20 results', async ({ page }) => {
	for (let index = 0; index < 21; index++) {
		await page.goto('/items/new');
		await page.getByLabel('Titel').fill(`Kappung Suchtreffer ${index}`);
		await page.getByRole('button', { name: 'Anlegen' }).click();
	}

	await page.goto('/suche?q=Kappung');
	await expect(page.getByText('20 von 21 Treffern')).toBeVisible();
	await expect(
		page.getByText(
			'Die 20 besten Treffer werden angezeigt. Ein genauerer Suchbegriff grenzt weiter ein.'
		)
	).toBeVisible();
	await expect(page.locator('.search-results > li')).toHaveCount(20);
});

test('Search debounces live input, handles Escape, and remains available on mobile', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Tablet Search Test');
	await page.getByRole('button', { name: 'Anlegen' }).click();

	await page.goto('/suche');
	const input = page.getByLabel('Suchbegriff');
	await expect(input).toBeFocused();
	await input.fill('Tablet');
	await expect(page).toHaveURL(/\/suche\?q=tablet/);
	await expect(page.getByRole('link', { name: /Tablet Search Test/ })).toBeVisible();
	await input.fill('T');
	await expect(input).toHaveValue('T');
	await expect(page.getByText('Noch ein Zeichen …')).toBeVisible();
	await expect(page).toHaveURL(/\/suche\?q=tablet/);
	await input.fill('Tablet');
	await expect(page.getByRole('link', { name: /Tablet Search Test/ })).toBeVisible();

	await page.setViewportSize({ width: 375, height: 667 });
	await expect(page.getByRole('link', { name: 'Suchen', exact: true })).toBeVisible();
	await expect(page.locator('.search-results a')).toHaveCSS('min-height', '60px');
	expect(await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(
		true
	);
	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(/\/suche$/);
	await expect(input).toBeFocused();
});

test('Search does not disclose results without an authenticated session', async ({ page }) => {
	await page.context().clearCookies();
	await page.goto('/suche?q=vertrag');
	await expect(page).toHaveURL(/\/login\?redirectTo=/);
});

test('Search shows the no-results copy for a completed GET query', async ({ page }) => {
	await page.goto('/suche?q=keinesuchergebnis');
	await expect(page.getByText('Keine Treffer', { exact: true })).toBeVisible();
	await expect(page.getByText('Keine Treffer für „keinesuchergebnis“')).toBeVisible();
});

test('Search GET submission works without JavaScript', async ({ browser }) => {
	const context = await browser.newContext({
		javaScriptEnabled: false,
		storageState: '.data-e2e/playwright-auth.json'
	});
	const page = await context.newPage();
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('JavaScript freie Suche');
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await page.goto('/suche');
	await page.getByLabel('Suchbegriff').fill('JavaScript');
	await page.getByLabel('Suchbegriff').press('Enter');
	await expect(page).toHaveURL(/\/suche\?q=JavaScript/);
	await expect(page.getByRole('link', { name: /JavaScript freie Suche/ })).toBeVisible();
	await context.close();
});
