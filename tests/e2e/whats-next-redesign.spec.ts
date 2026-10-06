import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 2 of the What's Next redesign: round done control, native "more"
 * menu (skip + date-change link), server-side filters/counts, per-bucket
 * grouping (an Item can appear in more than one section), and the
 * round-done undo notice (including its failure paths). Every test
 * creates its own generic or playbook item and archives it in a
 * `finally` block — never deletes shared fixtures and never asserts an
 * absolute global count, only deltas or the test's own scoped rows
 * (shared suite state).
 */

const ORIGIN = 'http://127.0.0.1:4173';

async function createGenericItem(page: Page, title: string): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	return page.url().split('/').pop()!;
}

async function addManualAction(page: Page, label: string, dueDate?: string) {
	const addActionForm = page.locator('form[action="?/addManualAction"]');
	await page.locator('summary', { hasText: 'Aufgabe hinzufügen' }).click();
	await addActionForm.getByLabel('Bezeichnung der Aufgabe').fill(label);
	if (dueDate) await addActionForm.getByLabel('Fällig am (optional)').fill(dueDate);
	await addActionForm.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
}

/** Creates a TÜV item with its "next_inspection" date filled in, so
 *  "HU-Termin planen" is an OPEN, DERIVED action with a resolved due
 *  date — the only kind of action the detail page's date editor accepts
 *  (see WorkflowTimeline's canEditDueDate). A manual Action is MANUAL,
 *  never DERIVED, and must not stand in for it in these tests. */
async function createTuvItemWithDerivedAction(page: Page, title: string): Promise<string> {
	await page.goto('/items/new');
	await page.getByLabel('Titel').fill(title);
	await page.getByLabel('Vorlage').selectOption({ label: 'TÜV / Hauptuntersuchung' });
	await page.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
	const itemId = page.url().split('/').pop()!;
	await page.locator('summary', { hasText: 'Angaben bearbeiten' }).click();
	await page.locator('input[type="date"]').first().fill('2099-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();
	return itemId;
}

/** Cleans up via the archive action directly (no UI roundtrip needed) —
 *  per the shared test-suite contract, created fixtures are archived,
 *  never left active and never asserted against as if the suite started
 *  empty. Tolerates an item that is already archived by the test itself. */
async function archiveItem(page: Page, itemId: string) {
	await page.request.post(`/items/${itemId}?/archiveItem`, {
		form: {},
		headers: { accept: 'text/html', origin: ORIGIN }
	});
}

/** Parses a filter chip's "(N)" count — or 0 when the working set is
 *  currently empty and the filter bar (and its chips) do not render at
 *  all, since that is itself the N=0 case. */
async function chipCount(page: Page, name: RegExp): Promise<number> {
	const link = page.getByRole('link', { name });
	if ((await link.count()) === 0) return 0;
	const text = await link.textContent();
	return Number(text!.match(/\((\d+)\)/)![1]);
}

function dateInDays(days: number): string {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

test('round done control completes the action, offers undo, and both work with JavaScript disabled', async ({
	browser
}) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	const title = `Done+Undo ${Date.now()}`;
	const itemId = await createGenericItem(page, title);
	try {
		await addManualAction(page, 'Ready task');

		await page.goto('/');
		const group = page.locator('.item-group', { hasText: title });
		await expect(group).toBeVisible();

		await group.getByRole('button', { name: 'Erledigen: Ready task' }).click();
		await expect(page.locator('.undo-notice')).toContainText('Ready task');
		await expect(page.locator('.item-group', { hasText: title })).toHaveCount(0);

		// The undo control is a real tap target, not a 32px text link.
		const undoButton = page.locator('.undo-notice').getByRole('button', { name: 'Rückgängig' });
		const undoBox = await undoButton.boundingBox();
		expect(undoBox).not.toBeNull();
		expect(undoBox!.width).toBeGreaterThanOrEqual(44);
		expect(undoBox!.height).toBeGreaterThanOrEqual(44);

		await undoButton.click();
		await expect(page.locator('.item-group', { hasText: title })).toBeVisible();
		await expect(page.locator('.undo-notice')).toHaveCount(0);
	} finally {
		await archiveItem(page, itemId);
		await context.close();
	}
});

test('completing a DERIVED action from root blocks its dependent again after undo', async ({
	page
}) => {
	const title = `Dependency ${Date.now()}`;
	const itemId = await createTuvItemWithDerivedAction(page, title);
	try {
		await page.goto('/');
		const group = page.locator('.item-group', { hasText: title });
		await expect(group.getByText('Fahrzeug / Unterlagen vorbereiten')).toHaveCount(0);

		await group.getByRole('button', { name: 'Erledigen: HU-Termin planen' }).click();
		// The dependent Action is now available and shows up as its own row.
		await expect(
			page.locator('.item-group', { hasText: title }).getByText('Fahrzeug / Unterlagen vorbereiten')
		).toBeVisible();

		await page.locator('.undo-notice').getByRole('button', { name: 'Rückgängig' }).click();
		// Reopening "HU-Termin planen" takes away the dependent's availability
		// again — dependency state is always re-derived live, never cached.
		await expect(
			page.locator('.item-group', { hasText: title }).getByText('Fahrzeug / Unterlagen vorbereiten')
		).toHaveCount(0);
		await expect(
			page.locator('.item-group', { hasText: title }).getByText('HU-Termin planen')
		).toBeVisible();
	} finally {
		await archiveItem(page, itemId);
	}
});

test('native menu date-change link reaches the DERIVED action and its own date editor', async ({
	page
}) => {
	const title = `Menu ${Date.now()}`;
	const itemId = await createTuvItemWithDerivedAction(page, title);
	try {
		await page.goto('/');
		const group = page.locator('.item-group', { hasText: title });
		const row = group.locator('.action-row', { hasText: 'HU-Termin planen' });
		await row.locator('summary').click();
		const link = row.getByRole('link', { name: 'Datum ändern' });
		const skipContrast = await row
			.getByRole('button', { name: 'Überspringen' })
			.evaluate((button) => {
				function luminance(color: string): number {
					const channels = color
						.match(/[\d.]+/g)!
						.slice(0, 3)
						.map(Number);
					const linear = channels.map((channel) => {
						const value = channel / 255;
						return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
					});
					return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
				}
				const panel = button.closest('.action-menu__panel')!;
				const foreground = luminance(getComputedStyle(button).color);
				const background = luminance(getComputedStyle(panel).backgroundColor);
				return (
					(Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
				);
			});
		expect(skipContrast).toBeGreaterThanOrEqual(4.5);
		await expect(link).toHaveAttribute('href', new RegExp(`/items/${itemId}#action-`));
		await link.click();
		await expect(page).toHaveURL(new RegExp(`/items/${itemId}#action-`));

		// The link lands on the exact step, and that step's own date editor
		// (DERIVED-only) is reachable — proving this is not a manual Action.
		const step = page.locator('.timeline__step').filter({
			has: page.locator('.timeline__title', { hasText: 'HU-Termin planen' })
		});
		const dueTrigger = step.getByRole('button', { name: 'Termin ändern' });
		await expect(dueTrigger).toBeVisible();
		await dueTrigger.click();
		await expect(step.getByRole('dialog', { name: 'Termin ändern' })).toBeVisible();

		await page.goto('/');
		const group2 = page.locator('.item-group', { hasText: title });
		const row2 = group2.locator('.action-row', { hasText: 'HU-Termin planen' });
		await row2.locator('summary').click();
		await row2.getByRole('button', { name: 'Überspringen' }).click();
		await expect(group2.locator('.action-row', { hasText: 'HU-Termin planen' })).toHaveCount(0);
	} finally {
		await archiveItem(page, itemId);
	}
});

test('filter chips reflect exact count deltas per bucket, reject unknown filters and preserve the active filter after done', async ({
	page
}) => {
	await page.goto('/');
	const allBefore = await chipCount(page, /^Alle \(\d+\)$/);
	const overdueBefore = await chipCount(page, /^Überfällig \(\d+\)$/);
	const nowBefore = await chipCount(page, /^Jetzt möglich \(\d+\)$/);
	const laterBefore = await chipCount(page, /^Später \(\d+\)$/);

	const title = `Filters ${Date.now()}`;
	const itemId = await createGenericItem(page, title);
	try {
		await addManualAction(page, 'Overdue task', '2020-01-01');
		await addManualAction(page, 'Ready task');
		await addManualAction(page, 'Later task', '2099-01-01');

		await page.goto('/');
		expect(await chipCount(page, /^Alle \(\d+\)$/)).toBe(allBefore + 3);
		expect(await chipCount(page, /^Überfällig \(\d+\)$/)).toBe(overdueBefore + 1);
		expect(await chipCount(page, /^Jetzt möglich \(\d+\)$/)).toBe(nowBefore + 1);
		expect(await chipCount(page, /^Später \(\d+\)$/)).toBe(laterBefore + 1);
		await expect(page.locator('.item-group', { hasText: title })).toHaveCount(3);

		await page.getByRole('link', { name: /^Überfällig \(\d+\)$/ }).click();
		await expect(page).toHaveURL(/\?filter=overdue$/);
		await expect(page.getByText('Overdue task')).toBeVisible();
		await expect(page.getByText('Ready task')).not.toBeVisible();

		// Completing from a filtered view must return to that SAME filter,
		// not reset to "all" — the filter rides the form action's query.
		const row = page.locator('.action-row', { hasText: 'Overdue task' });
		await expect(row.locator('form[action="?/completeAction&filter=overdue"]')).toHaveCount(1);
		await row.getByRole('button', { name: 'Erledigen: Overdue task' }).click();
		await expect(page).toHaveURL(/\?filter=overdue$/);

		// The future row stays in its own bucket, without the other rows.
		// A globally empty section is tested with a controlled load fixture.
		await page.goto('/?filter=later');
		await expect(page.locator('.item-group', { hasText: title })).toHaveCount(1);
		await expect(page.getByText('Later task', { exact: true })).toBeVisible();
		await expect(page.getByText('Ready task', { exact: true })).toHaveCount(0);

		await page.goto('/?filter=not-a-real-filter');
		await expect(page.getByRole('link', { name: /^Alle \(\d+\)$/ })).toHaveAttribute(
			'aria-current',
			'page'
		);
	} finally {
		await archiveItem(page, itemId);
	}
});

test('an item with both an overdue and a ready action appears once per section with each action exactly once', async ({
	page
}) => {
	const title = `Mixed ${Date.now()}`;
	const itemId = await createGenericItem(page, title);
	try {
		await addManualAction(page, 'Overdue part', '2020-01-01');
		await addManualAction(page, 'Ready part');

		await page.goto('/');
		const groups = page.locator('.item-group', { hasText: title });
		await expect(groups).toHaveCount(2);
		await expect(groups.filter({ hasText: 'Overdue part' })).toHaveCount(1);
		await expect(groups.filter({ hasText: 'Ready part' })).toHaveCount(1);
		await expect(page.getByText('Overdue part')).toHaveCount(1);
		await expect(page.getByText('Ready part')).toHaveCount(1);
	} finally {
		await archiveItem(page, itemId);
	}
});

test('the rendered due text shows both the relative pill and the exact date, including for an undated ready action', async ({
	page
}) => {
	const title = `Dates ${Date.now()}`;
	const itemId = await createGenericItem(page, title);
	try {
		// Distinct, non-overlapping labels — "Dated"/"Undated" would make
		// a substring `hasText` match ambiguous between the two rows.
		await addManualAction(page, 'Has a due date', '2020-01-01');
		await addManualAction(page, 'No due date at all');

		await page.goto('/');
		const datedRow = page.locator('.action-row', { hasText: 'Has a due date' });
		await expect(datedRow.locator('.due-pill')).toBeVisible();
		await expect(datedRow).toContainText('1. Januar 2020');
		await expect(datedRow).not.toContainText('Überfällig seit');

		const undatedRow = page.locator('.action-row', { hasText: 'No due date at all' });
		await expect(undatedRow.locator('.due-pill')).toHaveText('Jetzt möglich');
		await expect(undatedRow).toContainText('Ohne Datum');
		await expect(undatedRow).not.toContainText('jederzeit');
	} finally {
		await archiveItem(page, itemId);
	}
});

test('later rows sort by due date ascending while undated ready actions keep their order', async ({
	page
}) => {
	const title = `Sorted rows ${Date.now()}`;
	const itemId = await createGenericItem(page, title);
	try {
		await addManualAction(page, 'Due in sixty days', dateInDays(60));
		await addManualAction(page, 'Due in four days', dateInDays(4));
		await addManualAction(page, 'Ready first');
		await addManualAction(page, 'Ready second');
		await page.goto('/');

		const ownItem = page.getByRole('link', { name: title, exact: true });
		const rows = page
			.locator('section[aria-labelledby="section-2"] .item-group')
			.filter({ has: ownItem });
		const actual: string[] = [];
		for (const row of await rows.all()) {
			actual.push((await row.locator('.action-row__label').textContent())!.trim());
		}
		expect(actual.slice(0, 2)).toEqual(['Due in four days', 'Due in sixty days']);

		const readyRows = page
			.locator('section[aria-labelledby="section-1"] .item-group')
			.filter({ has: ownItem });
		const readyLabels: string[] = [];
		for (const row of await readyRows.all()) {
			if (await row.getByRole('link', { name: title, exact: true }).count()) {
				readyLabels.push((await row.locator('.action-row__label').textContent())!.trim());
			}
		}
		expect(readyLabels).toEqual(['Ready first', 'Ready second']);

		for (const row of await rows.all()) {
			await expect(row.locator('.action-row__item')).toHaveText(title);
		}
		const rowHeights = await rows.evaluateAll((elements) =>
			elements.map(
				(element) => element.querySelector('.action-row')!.getBoundingClientRect().height
			)
		);
		expect(
			rowHeights.every((height) => height >= 60 && height <= 76),
			`${rowHeights}`
		).toBe(true);
		const allLaterRows = page.locator('section[aria-labelledby="section-2"] .item-group');
		const rowGaps = await allLaterRows.evaluateAll((elements) => {
			const boxes = elements.map((element) =>
				element.querySelector('.action-row')!.getBoundingClientRect()
			);
			return boxes.slice(1).map((box, index) => box.top - boxes[index].bottom);
		});
		expect(
			rowGaps.every((gap) => gap <= 1),
			`${rowGaps}`
		).toBe(true);
	} finally {
		await archiveItem(page, itemId);
	}
});

test('stale or invalid undo attempts are refused with a rendered 400, never a 500, and do not disturb the action', async ({
	page
}) => {
	const title = `StaleUndo ${Date.now()}`;
	const itemId = await createGenericItem(page, title);
	try {
		await addManualAction(page, 'Guarded task');
		await addManualAction(page, 'Archived task');

		// 1) No prior completion at all.
		await page.goto('/');
		const noCookieResponse = await page.request.post('/?/undoAction', {
			form: {},
			headers: { accept: 'text/html', origin: ORIGIN }
		});
		expect(noCookieResponse.status()).toBe(400);

		// 2) Complete, then reopen through the detail page directly (bypassing
		// the root undo notice) so the flash cookie now points at an action
		// that is already OPEN — undo must reject it as not mutable, not 500.
		const group = page.locator('.item-group', { hasText: title });
		await group.getByRole('button', { name: 'Erledigen: Guarded task' }).click();
		await expect(page.locator('.undo-notice')).toBeVisible();
		await page.goto(`/items/${itemId}`);
		await page
			.locator('form[action="?/reopenAction"]')
			.getByRole('button', { name: 'Wieder öffnen' })
			.click();
		await page.goto('/');
		await expect(page.locator('.undo-notice')).toBeVisible(); // stale notice still rendered
		await page.locator('.undo-notice').getByRole('button', { name: 'Rückgängig' }).click();
		await expect(page.locator('.form-error')).toBeVisible();
		await expect(page.locator('.item-group', { hasText: title })).toHaveCount(2); // state unchanged

		// 3) An undo cookie naming an unknown/deleted action id.
		await page.context().addCookies([
			{
				name: 'whatsnext_undo',
				value: JSON.stringify({ itemId, actionId: 'does-not-exist', label: 'Ghost' }),
				url: ORIGIN
			}
		]);
		const unknownResponse = await page.request.post('/?/undoAction', {
			form: { itemId, actionId: 'does-not-exist' },
			headers: { accept: 'text/html', origin: ORIGIN }
		});
		expect(unknownResponse.status()).toBe(400);

		// 4) A malformed (non-JSON) cookie value must fail safely too.
		await page
			.context()
			.addCookies([{ name: 'whatsnext_undo', value: 'not-json-at-all', url: ORIGIN }]);
		const malformedResponse = await page.request.post('/?/undoAction', {
			form: {},
			headers: { accept: 'text/html', origin: ORIGIN }
		});
		expect(malformedResponse.status()).toBe(400);

		// 5) A GENUINELY isolated archived-item case: complete a second,
		// untouched action (still legitimately DONE, a normally-valid undo
		// target), archive the item, then attempt undo — isolating the
		// archived guard from the already-open guard exercised in step 2.
		await page.goto('/');
		await page
			.locator('.item-group', { hasText: title })
			.getByRole('button', { name: 'Erledigen: Archived task' })
			.click();
		await expect(page.locator('.undo-notice')).toContainText('Archived task');
		const archivedActionId = await page.locator('.undo-notice input[name="actionId"]').inputValue();
		await archiveItem(page, itemId);
		const archivedResponse = await page.request.post('/?/undoAction', {
			form: { itemId, actionId: archivedActionId },
			headers: { accept: 'text/html', origin: ORIGIN }
		});
		expect(archivedResponse.status()).toBe(400);
	} finally {
		await archiveItem(page, itemId);
	}
});

test('an outdated notice in another tab never reopens the newer completed action', async ({
	page
}) => {
	const title = `Two-tab undo ${Date.now()}`;
	const itemId = await createGenericItem(page, title);
	const other = await page.context().newPage();
	try {
		await addManualAction(page, 'First tab task');
		await addManualAction(page, 'Second tab task');
		await page.goto('/');
		await page
			.locator('.item-group', { hasText: title })
			.getByRole('button', { name: 'Erledigen: First tab task' })
			.click();
		await expect(page.locator('.undo-notice')).toContainText('First tab task');
		await other.goto('/');
		await other
			.locator('.item-group', { hasText: title })
			.getByRole('button', { name: 'Erledigen: Second tab task' })
			.click();
		await expect(other.locator('.undo-notice')).toContainText('Second tab task');

		const [rejected] = await Promise.all([
			page.waitForResponse(
				(response) =>
					response.request().method() === 'POST' && response.url().includes('/undoAction')
			),
			page.locator('.undo-notice').getByRole('button', { name: 'Rückgängig' }).click()
		]);
		expect(rejected.status()).toBe(400);
		await expect(page.getByRole('alert')).toHaveText(
			'Diese Aktion kann nicht mehr rückgängig gemacht werden.'
		);
		await other.goto(`/items/${itemId}`);
		for (const label of ['First tab task', 'Second tab task']) {
			await expect(other.locator('.timeline__step', { hasText: label })).toContainText('Erledigt');
		}

		await other.goto('/');
		await expect(other.locator('.undo-notice')).toContainText('Second tab task');
		await other.locator('.undo-notice').getByRole('button', { name: 'Rückgängig' }).click();
		const group = other.locator('.item-group', { hasText: title });
		await expect(group.getByText('Second tab task', { exact: true })).toBeVisible();
		await expect(group.getByText('First tab task', { exact: true })).toHaveCount(0);
	} finally {
		await other.close();
		await archiveItem(page, itemId);
	}
});

test('375px: a long item title and an open action menu do not overflow the viewport', async ({
	page
}) => {
	await page.setViewportSize({ width: 375, height: 700 });
	const title = `A very long item title that wraps across more than one line on a narrow phone screen ${Date.now()}`;
	const itemId = await createGenericItem(page, title);
	try {
		await addManualAction(page, 'Narrow task');

		await page.goto('/');
		const row = page.locator('.action-row', { hasText: 'Narrow task' });
		await row.locator('summary').click();
		await expect(row.getByRole('link', { name: 'Datum ändern' })).toBeVisible();
		const done = await row.getByRole('button', { name: 'Erledigen: Narrow task' }).boundingBox();
		const label = await row.locator('.action-row__label').boundingBox();
		const more = await row.locator('summary').boundingBox();
		expect(done).not.toBeNull();
		expect(label).not.toBeNull();
		expect(more).not.toBeNull();
		expect(done!.width).toBe(44);
		expect(done!.height).toBe(44);
		expect(done!.x).toBeLessThan(label!.x);
		expect(more!.x).toBeGreaterThan(label!.x);

		const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
		expect(scrollWidth).toBeLessThanOrEqual(375);
	} finally {
		await archiveItem(page, itemId);
	}
});

test.describe('filter links without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('each filter selects its bucket through a normal link', async ({ page }) => {
		const title = `No-JS filters ${Date.now()}`;
		const itemId = await createGenericItem(page, title);
		try {
			await addManualAction(page, 'No-JS overdue', '2020-01-01');
			await addManualAction(page, 'No-JS ready');
			await addManualAction(page, 'No-JS later', '2099-01-01');
			await page.goto('/');
			const cases: Array<[RegExp, string, string]> = [
				[/^Überfällig \(\d+\)$/, 'overdue', 'No-JS overdue'],
				[/^Jetzt möglich \(\d+\)$/, 'now', 'No-JS ready'],
				[/^Später \(\d+\)$/, 'later', 'No-JS later']
			];
			for (const [name, filter, label] of cases) {
				await page.getByRole('link', { name }).click();
				await expect(page).toHaveURL(`/?filter=${filter}`);
				await expect(page.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
				const group = page.locator('.item-group', { hasText: title });
				await expect(group.locator('.action-row')).toHaveCount(1);
				await expect(group.getByText(label, { exact: true })).toBeVisible();
			}
			await page.getByRole('link', { name: /^Alle \(\d+\)$/ }).click();
			await expect(page).toHaveURL('/');
			await expect(page.locator('.item-group', { hasText: title })).toHaveCount(3);
		} finally {
			await archiveItem(page, itemId);
		}
	});
});
