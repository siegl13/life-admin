import { applyOffset, compareIsoDate, isIsoDate, type IsoDate } from '../date/isoDate';

export interface NotificationSnooze {
	actionId: string;
	sourceDueDate: IsoDate;
	snoozedUntil: IsoDate;
	version: string;
}

export type SnoozeChoice = 'TOMORROW' | 'THREE_DAYS' | 'SEVEN_DAYS' | string;

export function snoozeDate(choice: SnoozeChoice, todayIso: IsoDate): IsoDate | null {
	if (choice === 'TOMORROW') return applyOffset(todayIso, { days: 1 });
	if (choice === 'THREE_DAYS') return applyOffset(todayIso, { days: 3 });
	if (choice === 'SEVEN_DAYS') return applyOffset(todayIso, { days: 7 });
	return isIsoDate(choice) ? choice : null;
}

export function isValidSnoozeDate(date: string, todayIso: IsoDate): date is IsoDate {
	return (
		isIsoDate(date) &&
		compareIsoDate(date, todayIso) > 0 &&
		compareIsoDate(date, applyOffset(todayIso, { days: 365 })) <= 0
	);
}
