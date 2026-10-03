import { describe, expect, it } from 'vitest';
import { applyOffset } from '$lib/domain/date/isoDate';
import { isValidSnoozeDate, snoozeDate } from './snooze';

describe('notification snooze dates', () => {
	const today = '2026-02-28';

	it('uses calendar days for presets', () => {
		expect(snoozeDate('TOMORROW', today)).toBe('2026-03-01');
		expect(snoozeDate('THREE_DAYS', today)).toBe('2026-03-03');
		expect(snoozeDate('SEVEN_DAYS', today)).toBe('2026-03-07');
	});

	it('accepts the inclusive 365-day boundary and rejects other dates', () => {
		const maximum = applyOffset(today, { days: 365 });
		expect(isValidSnoozeDate(maximum, today)).toBe(true);
		expect(isValidSnoozeDate(today, today)).toBe(false);
		expect(isValidSnoozeDate('2026-02-27', today)).toBe(false);
		expect(isValidSnoozeDate(applyOffset(maximum, { days: 1 }), today)).toBe(false);
		expect(isValidSnoozeDate('2026-02-30', today)).toBe(false);
	});
});
