import { expect, test } from '@playwright/test';

const MINIMAL_PDF = Buffer.from('%PDF-1.4\n%%EOF');

/**
 * Slice 8: archiving is a visibility switch, not a state change on the
 * item's work — it disappears from the live list and What's Next but
 * stays viewable, read-only, at its own URL, and can be reversed exactly.
 */
test('an archived item disappears from / and /items but stays viewable with a banner and no edit disclosures', async ({
	page
}) => {
	// Unique per run: the E2E database persists across the whole run (and
	// across retries/repeats), so a fixed title would collide with a
	// leftover item of the same name and make the `.link-list__row` lookup
	// below match more than one row.
	const title = `Archive Visibility Test ${Date.now()}`;
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();

	await page.goto('/items');
	await expect(page.locator('.link-list__row', { hasText: title })).toBeVisible();

	await page.goto(itemUrl);
	await page.locator('summary', { hasText: 'Archivieren' }).click();
	await page
		.locator('form[action="?/archiveItem"]')
		.getByRole('button', { name: 'Archivieren' })
		.click();

	// Banner and read-only state on the item's own page.
	await expect(page.locator('.notice__title', { hasText: 'Archiviert' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Wieder aktivieren' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Weitere Möglichkeiten' })).toHaveCount(0);
	await expect(page.locator('form[action="?/updateFields"]')).toHaveCount(0);

	// Gone from the active item list. (An archived item's actions no
	// longer appearing in What's Next is covered at the repository level
	// in whatsNextRepository.test.ts, with a real playbook item.)
	await page.goto('/items');
	await expect(page.locator('.link-list__row', { hasText: title })).toHaveCount(0);
});

test('an archived item is listed under "Archiv anzeigen" and can be reactivated', async ({
	page
}) => {
	// Unique per run — see the comment in the test above.
	const title = `Archive Reactivate Test ${Date.now()}`;
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();

	await page.locator('summary', { hasText: 'Archivieren' }).click();
	await page
		.locator('form[action="?/archiveItem"]')
		.getByRole('button', { name: 'Archivieren' })
		.click();

	await page.goto('/items');
	await page.getByRole('link', { name: 'Archiv anzeigen' }).click();
	await expect(page).toHaveURL(/\?archived=1$/);
	await expect(page.locator('.link-list__row', { hasText: title })).toBeVisible();

	await page.goto(itemUrl);
	await page.getByRole('button', { name: 'Wieder aktivieren' }).click();

	await expect(page).toHaveURL(itemUrl);
	await expect(page.getByRole('button', { name: 'Wieder aktivieren' })).toHaveCount(0);
	await expect(page.locator('.notice__title', { hasText: 'Archiviert' })).toHaveCount(0);
	await page.goto('/items');
	await expect(page.locator('.link-list__row', { hasText: title })).toBeVisible();
});

/**
 * Slice 8 review, finding 6: archived detail must be read-only EVERYWHERE,
 * not only on the surfaces the earlier Slice 8 pass happened to gate. This
 * uses the TÜV playbook (an open workflow step) and a real attachment
 * specifically because those are the two mutation surfaces the review
 * found still rendering their controls on an archived item.
 */
test('an archived item detail page has no mutation buttons or forms anywhere, and reactivation restores them', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Archive Readonly Everywhere Test');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2020-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByRole('heading', { name: 'Dokumente', level: 2 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Angaben', level: 2 })).toBeVisible();

	// "Dokumente verwalten" defaults open with zero attachments yet.
	await page
		.locator('form[action="?/addAttachment"]')
		.locator('input[type="file"]')
		.setInputFiles({ name: 'vertrag.pdf', mimeType: 'application/pdf', buffer: MINIMAL_PDF });
	await page
		.locator('form[action="?/addAttachment"]')
		.getByRole('button', { name: 'Hinzufügen' })
		.click();
	// Scoped to the read-only list: "Dokumente verwalten" defaults to closed
	// once an item has an attachment, and the same filename also exists
	// (hidden) in the still-in-DOM manage list.
	await expect(
		page.locator('.fields-view .document-row', { hasText: 'vertrag.pdf' })
	).toBeVisible();
	const attachmentHref = await page
		.locator('.fields-view .document-row')
		.getByRole('link', { name: 'vertrag.pdf' })
		.getAttribute('href');
	expect(attachmentHref).toBeTruthy();

	// The featured open action is controlled from the hero card.
	await expect(page.locator('.next-up').getByRole('button', { name: 'Erledigen' })).toBeVisible();

	await page.locator('summary', { hasText: 'Archivieren' }).click();
	await page
		.locator('form[action="?/archiveItem"]')
		.getByRole('button', { name: 'Archivieren' })
		.click();
	await expect(page).toHaveURL(itemUrl);

	// Every mutation surface is gone.
	await expect(page.getByRole('button', { name: 'Erledigen' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Überspringen' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Entfernen' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Speichern' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Neuer Zyklus' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Archivieren' })).toHaveCount(0);
	await expect(page.locator('summary', { hasText: 'Dokumente verwalten' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Weitere Möglichkeiten' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Dokumente', level: 2 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Angaben', level: 2 })).toBeVisible();
	// The attachment itself is still visible — read-only, not hidden. The
	// archived view has no manage/read duality at all (no remove capability
	// exists), so a plain, unscoped selector is unambiguous here.
	await expect(page.locator('.document-row', { hasText: 'vertrag.pdf' })).toBeVisible();
	await page.goto(attachmentHref!);
	await expect(page.getByRole('link', { name: 'Herunterladen' }).first()).toBeVisible();
	await expect(page.getByLabel('Anzeigename')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Informationen erkennen' })).toHaveCount(0);
	for (const [action, data] of [
		['rename', { displayName: 'Blocked' }],
		['extract', {}],
		['remove', {}]
	] as const) {
		const response = await page.request.post(`${attachmentHref}?/${action}`, {
			form: data,
			headers: { accept: 'text/html', origin: 'http://127.0.0.1:4173' }
		});
		expect(response.status()).toBe(400);
	}
	const archivedContent = await page.request.get(`${attachmentHref}/content`);
	expect(archivedContent.ok()).toBe(true);
	await page.goto(itemUrl);
	await expect(page.getByRole('button', { name: 'Wieder aktivieren' })).toBeVisible();

	// Reactivating brings every control back.
	await page.getByRole('button', { name: 'Wieder aktivieren' }).click();
	await expect(page).toHaveURL(itemUrl);
	await expect(page.locator('.next-up').getByRole('button', { name: 'Erledigen' })).toBeVisible();
	// "Entfernen" lives behind the "Dokumente verwalten" disclosure again.
	await page.locator('summary', { hasText: 'Dokumente verwalten' }).click();
	await expect(
		page
			.locator('.attachment-manage-row', { hasText: 'vertrag.pdf' })
			.getByRole('button', { name: 'Entfernen' })
	).toBeVisible();
});

test('the Items archive switch stays an inline, content-width control sharing the desktop heading row, not stretched full width or stacked below the title', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/items');
	const toggle = page.locator('.items-archive-toggle');
	const heading = page.locator('.page-head h1');
	await expect(toggle).toBeVisible();

	const [toggleBox, headingBox, pageHeadBox] = await Promise.all([
		toggle.boundingBox(),
		heading.boundingBox(),
		page.locator('.page-head').first().boundingBox()
	]);
	expect(toggleBox).not.toBeNull();
	expect(headingBox).not.toBeNull();
	expect(pageHeadBox).not.toBeNull();
	expect(toggleBox!.width).toBeLessThan(pageHeadBox!.width * 0.8);
	expect(toggleBox!.height).toBeGreaterThanOrEqual(44);
	// Rendered bounding-box height alone can be inflated by borders without
	// the control's own box actually meeting the touch-target token, so
	// also check the computed height.
	const computedHeight = await toggle.evaluate((node) => parseFloat(getComputedStyle(node).height));
	expect(computedHeight).toBeGreaterThanOrEqual(44);
	// Shares the heading row on desktop: vertically overlapping, not stacked
	// in a new row below the title.
	expect(toggleBox!.y).toBeLessThan(headingBox!.y + headingBox!.height);
	expect(toggleBox!.y + toggleBox!.height).toBeGreaterThan(headingBox!.y);

	// Forward: active list -> archive view.
	await toggle.click();
	await expect(page).toHaveURL(/\?archived=1$/);
	await expect(page.locator('.items-archive-toggle')).toBeVisible();
	// Back: archive view -> active list.
	await page.locator('.items-archive-toggle').click();
	await expect(page).toHaveURL(/\/items$/);
	await expect(page.locator('.items-archive-toggle')).toBeVisible();

	// General check: no other direct `.page-head` action anywhere in the
	// app renders wider than its heading column, i.e. nothing else is
	// silently inheriting the flex-column stretch this fix addresses.
	for (const route of ['/', '/upcoming', '/settings', '/suche', '/login', '/setup']) {
		await page.goto(route);
		const headButtons = page.locator('.page-head > .button, .page-head > a.button');
		const count = await headButtons.count();
		for (let i = 0; i < count; i++) {
			const box = await headButtons.nth(i).boundingBox();
			const headBox = await page.locator('.page-head').first().boundingBox();
			if (box && headBox) expect(box.width).toBeLessThan(headBox.width);
		}
	}
});

/**
 * Slice 8 review, finding 1/2/7: UI hiding is not the security boundary —
 * a crafted POST straight at the form action must still be refused once
 * the item is archived, even with a genuine, correctly-scoped actionId.
 */
test('a crafted completeAction POST against an archived item is refused, not just hidden in the UI', async ({
	page
}) => {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill('Archive Crafted POST Test');
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemUrl = page.url();
	const itemId = itemUrl.split('/').pop()!;

	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2020-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();

	const actionHref = await page
		.locator('.next-up form[action="?/completeAction"] input[name="actionId"]')
		.getAttribute('value');
	expect(actionHref).toBeTruthy();

	await page.locator('summary', { hasText: 'Archivieren' }).click();
	await page
		.locator('form[action="?/archiveItem"]')
		.getByRole('button', { name: 'Archivieren' })
		.click();

	const response = await page.request.post(`${itemUrl}?/completeAction`, {
		form: { actionId: actionHref!, itemId },
		headers: { accept: 'text/html', origin: 'http://127.0.0.1:4173' }
	});
	expect(response.status()).toBe(400);

	await page.goto(itemUrl);
	await page.getByRole('button', { name: 'Wieder aktivieren' }).click();
	await expect(page.locator('.next-up').getByRole('button', { name: 'Erledigen' })).toBeVisible(); // still OPEN — the crafted POST never completed it
});

test('the Items list shows a compact row with a small Playbook pill', async ({ page }) => {
	const title = `Items Compact Row Test ${Date.now()}`;
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	await page.goto('/items');
	const row = page.locator('.link-list__row', { hasText: title });
	await expect(row).toBeVisible();
	const playbookPill = row.locator('.items-list__playbook');
	await expect(playbookPill).toHaveText('TÜV / Hauptuntersuchung');
	await expect(playbookPill).toHaveClass(/\bpill\b/);
	const rowPadding = await row.evaluate((node) => getComputedStyle(node).paddingTop);
	const resolvedSpace3 = await page.evaluate(() => {
		const probe = document.createElement('div');
		probe.style.paddingTop = 'var(--space-3)';
		document.body.append(probe);
		const resolved = getComputedStyle(probe).paddingTop;
		probe.remove();
		return resolved;
	});
	expect(rowPadding).toBe(resolvedSpace3);
});

test('the Items archive toggle keeps its 44px touch target and wraps without horizontal overflow at mobile width', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/items');
	const toggle = page.locator('.items-archive-toggle');
	await expect(toggle).toBeVisible();

	const toggleBox = await toggle.boundingBox();
	expect(toggleBox).not.toBeNull();
	expect(toggleBox!.height).toBeGreaterThanOrEqual(44);
	const computedHeight = await toggle.evaluate((node) => parseFloat(getComputedStyle(node).height));
	expect(computedHeight).toBeGreaterThanOrEqual(44);

	const overflowX = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
	);
	expect(overflowX).toBe(false);

	await toggle.click();
	await expect(page).toHaveURL(/\?archived=1$/);
	await expect(page.locator('.items-archive-toggle')).toBeVisible();
	await page.locator('.items-archive-toggle').click();
	await expect(page).toHaveURL(/\/items$/);
});

test('a long custom Playbook name wraps or truncates in the Items pill without overflowing the row at mobile width', async ({
	page
}) => {
	const playbookId = `de.custom.longname-${Date.now()}`;
	const longName =
		'Jährliche Hauptuntersuchung und Abgasuntersuchung für den Firmenwagen mit erweitertem Prüfprotokoll und Dokumentenkontrolle';
	const yaml = [
		'schemaVersion: 1',
		`id: ${playbookId}`,
		'version: 1.0.0',
		`name: "${longName}"`,
		'fields: []',
		'events: []',
		'actions: []'
	].join('\n');

	await page.goto('/settings');
	await page.locator('summary', { hasText: 'Vorlage hinzufügen' }).click();
	await page.locator('#playbook-yaml').fill(yaml);
	await page.getByRole('button', { name: 'Vorlage installieren' }).click();
	await expect(page.locator(`[id="g-playbook-${playbookId}"]`)).toContainText(longName);

	const title = `Long Playbook Pill Test ${Date.now()}`;
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByLabel('Vorlage').selectOption({ label: longName });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/items');
	const row = page.locator('.link-list__row', { hasText: title });
	await expect(row).toBeVisible();
	const pill = row.locator('.items-list__playbook');
	await expect(pill).toHaveAttribute('title', longName);

	const [pillBox, rowBox] = await Promise.all([pill.boundingBox(), row.boundingBox()]);
	expect(pillBox).not.toBeNull();
	expect(rowBox).not.toBeNull();
	expect(pillBox!.width).toBeLessThanOrEqual(rowBox!.width + 1);
	const overflowX = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
	);
	expect(overflowX).toBe(false);
});
