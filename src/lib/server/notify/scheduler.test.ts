import { afterEach, describe, expect, it, vi } from 'vitest';
import { latchRestorePending } from '$lib/server/restoreState';
import { buildNotificationMessage } from '$lib/application/notify/message';
import { setLocaleProvider } from '$lib/i18n';
import { getRequestLocale } from '$lib/server/i18n/requestLocale';
import { createNotificationTick } from './scheduler';

// The same one-line wiring `hooks.server.ts` performs in production: reads
// the request-scoped locale `runWithLocale` sets, not a test-only constant.
setLocaleProvider(() => getRequestLocale() ?? 'de');

let storedLanguagePreference: string | null = null;

// Hoisted by vitest above these imports, so the real module (clock, ports,
// etc.) stays intact except for the one port createNotificationTick reads
// the saved UI language from.
vi.mock('$lib/server/appPorts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/appPorts')>();
	return {
		...actual,
		appSettingsPort: {
			get: vi.fn((key: string) => (key === 'ui.language' ? storedLanguagePreference : null)),
			set: vi.fn()
		}
	};
});

const reminder = {
	itemId: 'item-1',
	itemTitle: 'Electricity house',
	actionId: 'action-1',
	actionLabel: 'Send cancellation',
	kind: 'DUE_SOON' as const,
	targetDate: '2026-10-01'
};

describe('createNotificationTick', () => {
	afterEach(() => {
		storedLanguagePreference = null;
	});

	it.each([
		{ saved: 'de', expectedDate: '1. Oktober 2026' },
		{ saved: 'en', expectedDate: '1 October 2026' }
	])(
		'resolves the saved "$saved" preference through the scheduler locale context, formatting the notification body in that language',
		async ({ saved, expectedDate }) => {
			storedLanguagePreference = saved;
			let capturedBody: string | undefined;
			const dispatch = vi.fn().mockImplementation(async () => {
				// Built inside the tick's dispatch callback, i.e. under the
				// scheduler's own runWithLocale(locale, () => dispatch()) scope —
				// not substituted with a direct setLocaleProvider call.
				capturedBody = buildNotificationMessage(reminder, {
					minimalContent: false,
					origin: null
				}).body;
				return { sent: 0, failed: 0 };
			});
			const tick = createNotificationTick(dispatch, () => {});

			tick();
			// Flush the tick's internal async IIFE and the resolved dispatch call.
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(dispatch).toHaveBeenCalledTimes(1);
			expect(capturedBody).toContain(expectedDate);
		}
	);
	it('skips overlapping dispatches and permits the next completed tick', async () => {
		let resolveFirst!: (value: { sent: number; failed: number }) => void;
		const first = new Promise<{ sent: number; failed: number }>((resolve) => {
			resolveFirst = resolve;
		});
		const dispatch = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ sent: 0, failed: 0 });
		const tick = createNotificationTick(dispatch, () => {});

		tick();
		tick();
		expect(dispatch).toHaveBeenCalledTimes(1);

		resolveFirst!({ sent: 0, failed: 0 });
		await first;
		await Promise.resolve();
		tick();
		expect(dispatch).toHaveBeenCalledTimes(2);
	});

	it('does not dispatch or reopen the database while restore is pending', async () => {
		latchRestorePending({ safetyBackup: 'pre-restore-test.zip' });
		const dispatch = vi.fn().mockResolvedValue({ sent: 0, failed: 0 });
		const recordTick = vi.fn();
		const tick = createNotificationTick(dispatch, recordTick);

		tick();
		await Promise.resolve();

		expect(dispatch).not.toHaveBeenCalled();
		expect(recordTick).not.toHaveBeenCalled();
	});
});
