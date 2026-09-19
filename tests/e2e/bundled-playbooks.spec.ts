import { expect, test } from '@playwright/test';

const PLAYBOOKS = [
	{ label: 'TÜV / Hauptuntersuchung', title: 'HU nur mit Titel' },
	{ label: 'Stromvertrag', title: 'Stromvertrag nur mit Titel' },
	{ label: 'Kfz-Leasing', title: 'Leasing nur mit Titel' },
	{ label: 'Reisebuchung', title: 'Reise nur mit Titel' },
	{ label: 'Wartung & Prüfung', title: 'Wärmepumpe nur mit Titel' }
] as const;

for (const playbook of PLAYBOOKS) {
	test(`${playbook.label} can create an incomplete item with only a title`, async ({ page }) => {
		await page.goto('/items/new');
		await page.getByLabel('Titel').fill(playbook.title);
		await page.getByLabel('Vorlage').selectOption({ label: playbook.label });
		await page.getByRole('button', { name: 'Anlegen' }).click();

		await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
		await expect(page.getByRole('heading', { name: playbook.title })).toBeVisible();
		await expect(page.locator('[name^="field:"][required]')).toHaveCount(0);
	});
}
