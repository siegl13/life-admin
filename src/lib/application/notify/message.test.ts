import { afterEach, describe, expect, it } from 'vitest';
import { buildNotificationMessage } from './message';
import { setLocaleProvider } from '$lib/i18n';

afterEach(() => setLocaleProvider(() => 'de'));

const reminder = {
	itemId: 'item-1',
	itemTitle: 'Electricity house',
	actionId: 'action-1',
	actionLabel: 'Send cancellation',
	kind: 'DUE_SOON' as const,
	targetDate: '2026-10-01'
};

describe('buildNotificationMessage', () => {
	it('contains only the reminder fields and an optional item URL', () => {
		const message = buildNotificationMessage(reminder, {
			minimalContent: false,
			origin: 'https://life.example'
		});
		expect(message.title).toBe('Electricity house');
		expect(message.body).toContain('Send cancellation');
		expect(message.clickUrl).toBe('https://life.example/items/item-1');
	});

	it('omits the click URL without an origin', () => {
		const message = buildNotificationMessage(reminder, { minimalContent: false, origin: null });
		expect(message.clickUrl).toBeNull();
		expect(message.body).toContain('Send cancellation');
	});

	it('uses overdue wording for overdue reminders', () => {
		const message = buildNotificationMessage(
			{ ...reminder, kind: 'OVERDUE' },
			{ minimalContent: false, origin: null }
		);
		expect(message.body).toContain('Überfällig');
	});

	it('follows the saved UI language through the existing locale context, not a fixed locale', () => {
		setLocaleProvider(() => 'de');
		const german = buildNotificationMessage(reminder, { minimalContent: false, origin: null });
		expect(german.body).toContain('1. Oktober 2026');

		setLocaleProvider(() => 'en');
		const english = buildNotificationMessage(reminder, { minimalContent: false, origin: null });
		expect(english.body).toContain('1 October 2026');
	});

	it('removes all item context in minimal mode', () => {
		expect(
			buildNotificationMessage(reminder, { minimalContent: true, origin: 'https://life.example' })
		).toEqual({ title: 'Life Admin', body: 'Es steht etwas an.', clickUrl: null });
	});
});
