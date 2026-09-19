import type { Reminder } from '$lib/domain/notify/reminders';
import { formatDate } from '$lib/ui/format';
import { t } from '$lib/i18n';
import type { NotificationMessage } from './ports';

export function buildNotificationMessage(
	reminder: Reminder,
	options: { minimalContent: boolean; origin: string | null }
): NotificationMessage {
	if (options.minimalContent) {
		return {
			title: t('notify.message.minimalTitle'),
			body: t('notify.message.minimal'),
			clickUrl: null
		};
	}
	return {
		title: reminder.itemTitle,
		body: `${reminder.actionLabel}\n${t(
			reminder.kind === 'OVERDUE' ? 'notify.message.overdue' : 'notify.message.dueOn',
			{ date: formatDate(reminder.targetDate) }
		)}`,
		clickUrl: options.origin ? `${options.origin}/items/${reminder.itemId}` : null
	};
}
