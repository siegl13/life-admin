import { applyOffset, compareIsoDate, type IsoDate } from '../date/isoDate';
import type { WhatsNextBucket } from '../whatsnext/whatsNext';

export type ReminderKind = 'DUE_SOON' | 'OVERDUE';

export interface ReminderCandidate {
	itemId: string;
	itemTitle: string;
	actionId: string;
	actionLabel: string;
	dueDate: IsoDate | null;
	bucket: WhatsNextBucket;
	leadDays: number;
}

export interface Reminder {
	itemId: string;
	itemTitle: string;
	actionId: string;
	actionLabel: string;
	kind: ReminderKind;
	targetDate: IsoDate;
}

/** Turns the already-filtered What's Next groups into today's notification candidates. */
export function buildDueReminders(
	candidates: readonly ReminderCandidate[],
	todayIso: IsoDate
): Reminder[] {
	const reminders: Reminder[] = [];
	for (const candidate of candidates) {
		if (candidate.dueDate === null || candidate.bucket === 1) continue;
		if (candidate.bucket === 0) {
			reminders.push({
				itemId: candidate.itemId,
				itemTitle: candidate.itemTitle,
				actionId: candidate.actionId,
				actionLabel: candidate.actionLabel,
				kind: 'OVERDUE',
				targetDate: candidate.dueDate
			});
			continue;
		}
		if (
			compareIsoDate(candidate.dueDate, applyOffset(todayIso, { days: candidate.leadDays })) <= 0
		) {
			reminders.push({
				itemId: candidate.itemId,
				itemTitle: candidate.itemTitle,
				actionId: candidate.actionId,
				actionLabel: candidate.actionLabel,
				kind: 'DUE_SOON',
				targetDate: candidate.dueDate
			});
		}
	}
	return reminders;
}
