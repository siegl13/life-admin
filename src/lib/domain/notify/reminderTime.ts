/** Default notification time. Matches the former fixed "not before 08:00" rule. */
export const DEFAULT_REMINDER_TIME = '08:00';

const REMINDER_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parses a strict `HH:MM` local time into minutes after local midnight. */
export function parseReminderTime(value: string): number | null {
	const match = REMINDER_TIME.exec(value.trim());
	return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * True once the local clock has reached the reminder time. A comparison, not an
 * equality check, so a tick skipped by a DST jump or a late start still sends.
 */
export function isReminderTimeReached(localMinuteOfDay: number, reminderTime: string): boolean {
	const minutes =
		parseReminderTime(reminderTime) ?? (parseReminderTime(DEFAULT_REMINDER_TIME) as number);
	return localMinuteOfDay >= minutes;
}
