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

async function activate(control: import('@playwright/test').Locator): Promise<void> {
	await control.focus();
	await control.press('Enter');
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
	const assignLink = row.locator('a[href*="/inbox?doc="]');
	if ((await assignLink.count()) > 0) await activate(assignLink);
	await expect(inboxDetail(page).getByRole('heading', { name: filename, level: 2 })).toBeVisible();
	await activate(inboxDetail(page).locator('button[formaction="?/delete"]'));
	await expect(row).toHaveCount(0);
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page): Promise<void> {
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
		.toBe(true);
}

async function createMatchingItem(
	page: import('@playwright/test').Page,
	title: string
): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByRole('button', { name: 'Anlegen' }).click();
	const match = page.url().match(/\/items\/([0-9a-f-]+)/);
	if (!match) throw new Error('item creation did not redirect to its detail page');
	return match[1];
}

async function archiveItem(page: import('@playwright/test').Page, itemId: string): Promise<void> {
	await page.goto(`/items/${itemId}`);
	await page.locator('summary', { hasText: 'Archivieren' }).click();
	await page
		.locator('form[action="?/archiveItem"]')
		.getByRole('button', { name: 'Archivieren' })
		.click();
}

test.describe('Inbox redesign: selection fallback and mobile list/detail order', () => {
	test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });

	test('falls back to the newest pending document for a missing, unknown or stale id', async ({
		page
	}) => {
		try {
			await uploadInboxDocument(page, 'inbox-fallback-older.pdf');
			const olderId = await inboxDetail(page).locator('input[name="documentId"]').inputValue();
			await uploadInboxDocument(page, 'inbox-fallback-newest.pdf');

			await page.goto('/inbox');
			await expect(
				inboxDetail(page).getByRole('heading', { name: 'inbox-fallback-newest.pdf', level: 2 })
			).toBeVisible();

			await page.goto('/inbox?doc=');
			await expect(
				inboxDetail(page).getByRole('heading', { name: 'inbox-fallback-newest.pdf', level: 2 })
			).toBeVisible();

			await page.goto('/inbox?doc=does-not-exist');
			await expect(
				inboxDetail(page).getByRole('heading', { name: 'inbox-fallback-newest.pdf', level: 2 })
			).toBeVisible();

			await page.goto('/inbox?view=something-unknown');
			await expect(
				inboxDetail(page).getByRole('heading', { name: 'inbox-fallback-newest.pdf', level: 2 })
			).toBeVisible();

			// A real id that existed but no longer does (deleted/routed away)
			// must fall back exactly like an invented one.
			await deleteIfPending(page, 'inbox-fallback-older.pdf');
			await page.goto(`/inbox?doc=${olderId}`);
			await expect(
				inboxDetail(page).getByRole('heading', { name: 'inbox-fallback-newest.pdf', level: 2 })
			).toBeVisible();
		} finally {
			await deleteIfPending(page, 'inbox-fallback-older.pdf');
			await deleteIfPending(page, 'inbox-fallback-newest.pdf');
		}
	});

	test('keeps newest-first order after an older document is analyzed', async ({ page }) => {
		await page.goto('/settings');
		await page.getByLabel('Ich habe verstanden, dass ausgewählte Dokumente an OpenAI').check();
		await page.getByRole('button', { name: 'Einschalten' }).click();
		try {
			await uploadInboxDocument(page, 'inbox-order-first.pdf');
			await uploadInboxDocument(page, 'inbox-order-second.pdf');

			const firstRow = inboxRow(page, 'inbox-order-first.pdf');
			await activate(firstRow.locator('a[href*="/inbox?doc="]'));
			await expect(
				inboxDetail(page).getByRole('heading', { name: 'inbox-order-first.pdf', level: 2 })
			).toBeVisible();
			await activate(inboxDetail(page).locator('button[formaction="?/analyze"]'));
			// The analyze action redirects to plain /inbox (losing ?doc), which
			// re-selects the newest pending document, not the one just
			// analyzed — the row pill is the reliable signal here.
			await expect(firstRow).toContainText('Vorschlag');

			const names = await page.locator('.inbox-list__name').allTextContents();
			expect(names.indexOf('inbox-order-second.pdf')).toBeLessThan(
				names.indexOf('inbox-order-first.pdf')
			);
		} finally {
			await deleteIfPending(page, 'inbox-order-first.pdf');
			await deleteIfPending(page, 'inbox-order-second.pdf');
			await page.goto('/settings');
			await page.getByRole('button', { name: 'Ausschalten' }).click();
		}
	});

	test('routing the oldest pending document selects the next newest remaining', async ({
		page
	}) => {
		try {
			await uploadInboxDocument(page, 'inbox-removal-a.pdf');
			await uploadInboxDocument(page, 'inbox-removal-b.pdf');

			const rowA = inboxRow(page, 'inbox-removal-a.pdf');
			await activate(rowA.locator('a[href*="/inbox?doc="]'));
			const routeForm = inboxDetail(page).locator('form[action="?/route"]');
			await routeForm.getByRole('radio', { name: 'Als neues Element anlegen' }).check();
			await routeForm.getByLabel('Titel').fill('Inbox removal item');
			await routeForm.getByLabel('Ich habe die Zuordnung geprüft.').check();
			await routeForm.getByRole('button', { name: 'Element anlegen und ablegen' }).click();

			await page.goto('/inbox');
			await expect(
				inboxDetail(page).getByRole('heading', { name: 'inbox-removal-b.pdf', level: 2 })
			).toBeVisible();
			await expect(inboxRow(page, 'inbox-removal-a.pdf')).toHaveCount(0);
		} finally {
			await deleteIfPending(page, 'inbox-removal-a.pdf');
			await deleteIfPending(page, 'inbox-removal-b.pdf');
		}
	});

	test('deleting one of several pending documents selects the newest remaining one', async ({
		page
	}) => {
		try {
			await uploadInboxDocument(page, 'inbox-delete-remaining-a.pdf');
			await uploadInboxDocument(page, 'inbox-delete-remaining-b.pdf');

			const rowA = inboxRow(page, 'inbox-delete-remaining-a.pdf');
			await activate(rowA.locator('a[href*="/inbox?doc="]'));
			await activate(inboxDetail(page).locator('button[formaction="?/delete"]'));

			await expect(
				inboxDetail(page).getByRole('heading', {
					name: 'inbox-delete-remaining-b.pdf',
					level: 2
				})
			).toBeVisible();
			await expect(inboxRow(page, 'inbox-delete-remaining-a.pdf')).toHaveCount(0);
		} finally {
			await deleteIfPending(page, 'inbox-delete-remaining-a.pdf');
			await deleteIfPending(page, 'inbox-delete-remaining-b.pdf');
		}
	});

	test('routing the last pending document shows the empty state', async ({ page }) => {
		try {
			await uploadInboxDocument(page, 'inbox-route-last.pdf');
			const routeForm = inboxDetail(page).locator('form[action="?/route"]');
			await routeForm.getByRole('radio', { name: 'Als neues Element anlegen' }).check();
			await routeForm.getByLabel('Titel').fill('Inbox last route item');
			await routeForm.getByLabel('Ich habe die Zuordnung geprüft.').check();
			await routeForm.getByRole('button', { name: 'Element anlegen und ablegen' }).click();

			await page.goto('/inbox');
			await expect(page.getByRole('heading', { name: 'Eingang leer', level: 2 })).toBeVisible();
		} finally {
			await deleteIfPending(page, 'inbox-route-last.pdf');
		}
	});

	test('detail panel comes first on mobile by default; an explicit list view puts the list first and stays reachable', async ({
		page
	}) => {
		try {
			await uploadInboxDocument(page, 'inbox-mobile-order.pdf');
			await page.goto('/inbox');
			const detailTopDefault = (await inboxDetail(page).boundingBox())?.y ?? Infinity;
			const listTopDefault = (await page.locator('.inbox-list').boundingBox())?.y ?? Infinity;
			expect(detailTopDefault).toBeLessThan(listTopDefault);

			const backLink = inboxDetail(page).getByRole('link', { name: 'Zurück zur Liste' });
			await expect(backLink).toBeVisible();
			await activate(backLink);
			await expect(page).toHaveURL(/view=list/);

			const detailTopListFirst = (await inboxDetail(page).boundingBox())?.y ?? -Infinity;
			const listTopListFirst = (await page.locator('.inbox-list').boundingBox())?.y ?? -Infinity;
			expect(listTopListFirst).toBeLessThan(detailTopListFirst);

			await expect(inboxRow(page, 'inbox-mobile-order.pdf')).toBeVisible();
			await expect(
				inboxDetail(page).getByRole('heading', { name: 'inbox-mobile-order.pdf', level: 2 })
			).toBeVisible();

			// The selected document's own row still has a native selection
			// link (labelled "Anzeigen"/"View" instead of "Zuordnen" since
			// it's already open) — this is how a no-JS user returns to
			// detail-first mode from the explicit list view.
			const selectedRowLink = inboxRow(page, 'inbox-mobile-order.pdf').getByRole('link', {
				name: 'Ausgewähltes Dokument öffnen: inbox-mobile-order.pdf'
			});
			await expect(selectedRowLink).toBeVisible();
			await activate(selectedRowLink);
			await expect(page).not.toHaveURL(/view=list/);
			const detailTopAfterReturn = (await inboxDetail(page).boundingBox())?.y ?? Infinity;
			const listTopAfterReturn = (await page.locator('.inbox-list').boundingBox())?.y ?? Infinity;
			expect(detailTopAfterReturn).toBeLessThan(listTopAfterReturn);
		} finally {
			await deleteIfPending(page, 'inbox-mobile-order.pdf');
		}
	});

	test('shows no horizontal overflow at 375px with a selected document', async ({ browser }) => {
		const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
		const narrowPage = await context.newPage();
		try {
			await uploadInboxDocument(narrowPage, 'inbox-375.pdf');
			await expectNoHorizontalOverflow(narrowPage);
		} finally {
			await deleteIfPending(narrowPage, 'inbox-375.pdf');
			await context.close();
		}
	});

	test('truncates a long filename without breaking inside words at mobile and desktop widths', async ({
		page
	}) => {
		for (const width of [1280, 390]) {
			const filename = `Annual electricity statement with payment and meter details final corrected version ${width}.pdf`;
			try {
				await page.setViewportSize({ width, height: 900 });
				await uploadInboxDocument(page, filename);
				const listName = inboxRow(page, filename).locator('.inbox-list__name');
				const detailName = inboxDetail(page).getByRole('heading', { level: 2 });
				await expect(listName).toHaveAttribute('title', filename);
				await expect(detailName).toHaveAttribute('title', filename);
				await expect(listName).toHaveCSS('white-space', 'nowrap');
				await expect(detailName).toHaveCSS('white-space', 'nowrap');
				await expectNoHorizontalOverflow(page);
			} finally {
				await deleteIfPending(page, filename);
			}
		}
	});
});

test.describe('Inbox redesign: desktop layout', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('a long list is not stretched to match the detail panel, and the sidebar still reaches the page bottom', async ({
		page
	}) => {
		const names = Array.from({ length: 8 }, (_, i) => `inbox-long-list-${i}.pdf`);
		try {
			for (const name of names) await uploadInboxDocument(page, name);
			await page.goto('/inbox');
			const listBox = await page.locator('.inbox-list').boundingBox();
			const detailBox = await inboxDetail(page).boundingBox();
			expect(listBox).not.toBeNull();
			expect(detailBox).not.toBeNull();
			// The list sizes to its own 8 rows. It is no longer forced to the
			// detail panel's height (the grid used to stretch both columns to
			// the row's tallest member regardless of each panel's own content).
			if (listBox && detailBox) {
				expect(Math.abs(listBox.height - detailBox.height)).toBeGreaterThan(2);
			}
			const sidebarBox = await page.locator('.app-sidebar').boundingBox();
			const pageBottom = await page.evaluate(() => document.documentElement.scrollHeight);
			expect(sidebarBox).not.toBeNull();
			if (sidebarBox) {
				expect(Math.abs(sidebarBox.y + sidebarBox.height - pageBottom)).toBeLessThan(2);
			}
		} finally {
			for (const name of names) await deleteIfPending(page, name);
		}
	});

	test('a playbook-only suggestion preselects the new-item destination and the suggested playbook', async ({
		page
	}) => {
		await page.goto('/settings');
		await page.getByLabel('Ich habe verstanden, dass ausgewählte Dokumente an OpenAI').check();
		await page.getByRole('button', { name: 'Einschalten' }).click();
		try {
			await uploadInboxDocument(page, 'inbox-preselect-playbook.pdf');
			await activate(inboxDetail(page).locator('button[formaction="?/analyze"]'));
			const routeForm = inboxDetail(page).locator('form[action="?/route"]');
			await expect(
				routeForm.getByRole('radio', { name: 'Als neues Element anlegen' })
			).toBeChecked();
			await expect(routeForm.locator('select[name="playbookId"] option:checked')).toHaveText(
				'Stromvertrag'
			);
		} finally {
			await deleteIfPending(page, 'inbox-preselect-playbook.pdf');
			await page.goto('/settings');
			await page.getByRole('button', { name: 'Ausschalten' }).click();
		}
	});

	test('an existing-item suggestion preselects and checks the existing-item destination', async ({
		page
	}) => {
		const title = 'document for existing-item preselection';
		const itemId = await createMatchingItem(page, title);

		await page.goto('/settings');
		await page.getByLabel('Ich habe verstanden, dass ausgewählte Dokumente an OpenAI').check();
		await page.getByRole('button', { name: 'Einschalten' }).click();
		try {
			await uploadInboxDocument(page, 'inbox-preselect.pdf');
			await activate(inboxDetail(page).locator('button[formaction="?/analyze"]'));
			const routeForm = inboxDetail(page).locator('form[action="?/route"]');
			await expect(
				routeForm.getByRole('radio', { name: 'Zu einem bestehenden Element' })
			).toBeChecked();
			await expect(routeForm.locator('select[name="itemId"]')).toHaveValue(itemId);
			await expect(routeForm.locator('select[name="itemId"] option:checked')).toHaveText(title);
		} finally {
			await deleteIfPending(page, 'inbox-preselect.pdf');
			await page.goto('/settings');
			await page.getByRole('button', { name: 'Ausschalten' }).click();
			await archiveItem(page, itemId);
		}
	});

	test('an existing-item suggestion takes precedence over a simultaneous playbook suggestion', async ({
		page
	}) => {
		const title = 'document for simultaneous-suggestion precedence';
		const itemId = await createMatchingItem(page, title);

		await page.goto('/settings');
		await page.getByLabel('Ich habe verstanden, dass ausgewählte Dokumente an OpenAI').check();
		await page.getByRole('button', { name: 'Einschalten' }).click();
		try {
			await uploadInboxDocument(page, 'inbox-preselect-precedence.pdf');
			await activate(inboxDetail(page).locator('button[formaction="?/analyze"]'));
			const routeForm = inboxDetail(page).locator('form[action="?/route"]');
			await expect(
				routeForm.getByRole('radio', { name: 'Zu einem bestehenden Element' })
			).toBeChecked();
			await expect(
				routeForm.getByRole('radio', { name: 'Als neues Element anlegen' })
			).not.toBeChecked();
			await expect(routeForm.locator('select[name="itemId"]')).toHaveValue(itemId);
			await expect(routeForm.locator('select[name="itemId"] option:checked')).toHaveText(title);
			await expect(routeForm.locator('select[name="playbookId"] option:checked')).toHaveText(
				'Stromvertrag'
			);
		} finally {
			await deleteIfPending(page, 'inbox-preselect-precedence.pdf');
			await page.goto('/settings');
			await page.getByRole('button', { name: 'Ausschalten' }).click();
			await archiveItem(page, itemId);
		}
	});

	test('the suggested badge fits inside the destination card at 375px', async ({ page }) => {
		const itemId = await createMatchingItem(page, 'document for narrow suggested badge');
		try {
			await page.setViewportSize({ width: 375, height: 812 });
			await page.goto('/settings');
			await page.getByLabel('Ich habe verstanden, dass ausgewählte Dokumente an OpenAI').check();
			await page.getByRole('button', { name: 'Einschalten' }).click();
			await uploadInboxDocument(page, 'inbox-375-suggested.pdf');
			await activate(inboxDetail(page).locator('button[formaction="?/analyze"]'));

			const card = inboxDetail(page)
				.locator('.route-option')
				.filter({ has: page.locator('input[value="existing"]') });
			const badge = card.locator('.suggested-badge');
			await expect(badge).toHaveText('Vorschlag');
			await expect(badge).toBeVisible();
			const cardBox = await card.boundingBox();
			const badgeBox = await badge.boundingBox();
			expect(cardBox).not.toBeNull();
			expect(badgeBox).not.toBeNull();
			if (cardBox && badgeBox) {
				expect(badgeBox.x).toBeGreaterThanOrEqual(cardBox.x);
				expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
			}
			await expectNoHorizontalOverflow(page);
		} finally {
			await deleteIfPending(page, 'inbox-375-suggested.pdf');
			await page.goto('/settings');
			await page.getByRole('button', { name: 'Ausschalten' }).click();
			await archiveItem(page, itemId);
		}
	});

	test('shows no horizontal overflow at 768px with a populated detail panel, a real suggestion and both destination forms', async ({
		browser
	}) => {
		for (const colorScheme of ['light', 'dark'] as const) {
			const context = await browser.newContext({
				viewport: { width: 768, height: 1024 },
				colorScheme
			});
			const page = await context.newPage();
			const filename = `inbox-768-${colorScheme}.pdf`;
			await page.goto('/settings');
			await page.getByLabel('Ich habe verstanden, dass ausgewählte Dokumente an OpenAI').check();
			await page.getByRole('button', { name: 'Einschalten' }).click();
			try {
				await uploadInboxDocument(page, filename);
				await activate(inboxDetail(page).locator('button[formaction="?/analyze"]'));
				await expect(inboxDetail(page).locator('.suggestion')).toBeVisible();
				const selectedRow = page.locator('.inbox-list__row--active');
				const selectedContrast = await selectedRow.evaluate((row) => {
					const luminance = (value: string) => {
						const [r, g, b] = value
							.match(/[\d.]+/g)!
							.slice(0, 3)
							.map(Number)
							.map((channel) => {
								const srgb = channel / 255;
								return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
							});
						return 0.2126 * r + 0.7152 * g + 0.0722 * b;
					};
					const ratio = (foreground: string, background: string) => {
						const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
						return (values[0] + 0.05) / (values[1] + 0.05);
					};
					const rowStyle = getComputedStyle(row);
					const nameStyle = getComputedStyle(row.querySelector('.inbox-list__name')!);
					const pillStyle = getComputedStyle(row.querySelector('.status-pill')!);
					const accentProbe = document.createElement('span');
					accentProbe.style.color = rowStyle.getPropertyValue('--color-accent');
					row.append(accentProbe);
					const accent = getComputedStyle(accentProbe).color;
					accentProbe.remove();
					return {
						row: ratio(nameStyle.color, rowStyle.backgroundColor),
						pill: ratio(pillStyle.color, pillStyle.backgroundColor),
						borderColor: rowStyle.borderTopColor,
						accent
					};
				});
				expect(selectedContrast.row).toBeGreaterThanOrEqual(4.5);
				expect(selectedContrast.pill).toBeGreaterThanOrEqual(4.5);
				expect(selectedContrast.borderColor).toBe(selectedContrast.accent);
				const routeForm = inboxDetail(page).locator('form[action="?/route"]');
				const existingRadio = routeForm.getByRole('radio', {
					name: 'Zu einem bestehenden Element'
				});
				const newRadio = routeForm.getByRole('radio', { name: 'Als neues Element anlegen' });
				await expect(existingRadio).toBeVisible();
				await expect(newRadio).toBeVisible();

				await existingRadio.check();
				await expect(routeForm.locator('select[name="itemId"]')).toBeVisible();
				await expectNoHorizontalOverflow(page);

				await newRadio.check();
				await expect(routeForm.getByLabel('Titel')).toBeVisible();
				await expect(routeForm.locator('select[name="playbookId"]')).toBeVisible();
				await expectNoHorizontalOverflow(page);
			} finally {
				await deleteIfPending(page, filename);
				await page.goto('/settings');
				await page.getByRole('button', { name: 'Ausschalten' }).click();
				await context.close();
			}
		}
	});

	test('destination cards are selectable by keyboard alone', async ({ page }) => {
		try {
			await uploadInboxDocument(page, 'inbox-keyboard.pdf');
			const routeForm = inboxDetail(page).locator('form[action="?/route"]');
			const existingRadio = routeForm.getByRole('radio', { name: 'Zu einem bestehenden Element' });
			const newRadio = routeForm.getByRole('radio', { name: 'Als neues Element anlegen' });
			await newRadio.focus();
			await page.keyboard.press('ArrowUp');
			await expect(existingRadio).toBeFocused();
			await expect(existingRadio).toBeChecked();
			await page.keyboard.press('ArrowDown');
			await expect(newRadio).toBeFocused();
			await expect(newRadio).toBeChecked();
		} finally {
			await deleteIfPending(page, 'inbox-keyboard.pdf');
		}
	});
});

test.describe('Inbox redesign: English copy', () => {
	test.use({ locale: 'en-US', viewport: { width: 390, height: 844 } });

	test('shows English status pill, back-to-list copy and a singular document count', async ({
		page
	}) => {
		await page.goto('/settings');
		await page.locator('#g-language form button[value="en"]').click();
		try {
			await uploadInboxDocument(page, 'inbox-english.pdf');
			await expect(inboxRow(page, 'inbox-english.pdf')).toContainText('Not analyzed');
			await expect(inboxDetail(page).getByRole('link', { name: 'All documents' })).toBeVisible();
			await expect(page.locator('.inbox-count')).toHaveText('1 document in the inbox');

			await uploadInboxDocument(page, 'inbox-english-2.pdf');
			await expect(page.locator('.inbox-count')).toHaveText('2 documents in the inbox');
		} finally {
			await deleteIfPending(page, 'inbox-english.pdf');
			await deleteIfPending(page, 'inbox-english-2.pdf');
			await page.goto('/settings');
			await page.locator('#g-language form button[value="browser"]').click();
		}
	});
});

test.describe('Inbox redesign: German copy', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('shows a singular and plural German document count', async ({ page }) => {
		try {
			await uploadInboxDocument(page, 'inbox-german.pdf');
			await expect(page.locator('.inbox-count')).toHaveText('1 Dokument im Eingang');

			await uploadInboxDocument(page, 'inbox-german-2.pdf');
			await expect(page.locator('.inbox-count')).toHaveText('2 Dokumente im Eingang');
		} finally {
			await deleteIfPending(page, 'inbox-german.pdf');
			await deleteIfPending(page, 'inbox-german-2.pdf');
		}
	});
});
