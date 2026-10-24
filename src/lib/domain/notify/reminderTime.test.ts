import { describe, expect, it } from 'vitest';
import { isReminderTimeReached, parseReminderTime } from './reminderTime';

describe('parseReminderTime', () => {
	it('parses whole-minute local times', () => {
		expect(parseReminderTime('08:00')).toBe(480);
		expect(parseReminderTime('00:00')).toBe(0);
		expect(parseReminderTime('23:59')).toBe(1439);
		expect(parseReminderTime(' 07:05 ')).toBe(425);
	});

	it.each(['', '8:00', '24:00', '12:60', '12:30:15', 'ab:cd', '12.30'])('rejects %j', (value) => {
		expect(parseReminderTime(value)).toBeNull();
	});
});

describe('isReminderTimeReached', () => {
	it('is false before and true at or after the time', () => {
		expect(isReminderTimeReached(7 * 60 + 59, '08:00')).toBe(false);
		expect(isReminderTimeReached(8 * 60, '08:00')).toBe(true);
		expect(isReminderTimeReached(8 * 60 + 14, '08:15')).toBe(false);
		expect(isReminderTimeReached(8 * 60 + 15, '08:15')).toBe(true);
	});

	it('still fires when a DST jump skips the exact minute', () => {
		// Spring forward: local clock goes 01:59 -> 03:00, 02:30 never exists.
		expect(isReminderTimeReached(1 * 60 + 59, '02:30')).toBe(false);
		expect(isReminderTimeReached(3 * 60, '02:30')).toBe(true);
	});

	it('falls back to the default for a corrupt stored value', () => {
		expect(isReminderTimeReached(7 * 60, 'garbage')).toBe(false);
		expect(isReminderTimeReached(8 * 60, 'garbage')).toBe(true);
	});
});
