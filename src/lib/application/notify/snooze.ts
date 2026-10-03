import { buildWhatsNext } from '$lib/domain/whatsnext/whatsNext';
import { isValidSnoozeDate, snoozeDate, type NotificationSnooze } from '$lib/domain/notify/snooze';
import type { Clock, WhatsNextRepositoryPort } from '$lib/application/ports';
import type { NotificationSnoozePort } from './ports';

export class InvalidSnoozeDateError extends Error {}
export class IneligibleSnoozeError extends Error {}

function eligibleAction(
	ports: { whatsNext: WhatsNextRepositoryPort },
	actionId: string,
	todayIso: string
): { itemId: string; dueDate: string } | null {
	for (const group of buildWhatsNext(ports.whatsNext.loadItems(), todayIso)) {
		const action = group.actions.find((candidate) => candidate.actionId === actionId);
		if (action?.dueDate) return { itemId: group.itemId, dueDate: action.dueDate };
	}
	return null;
}

export function setSnooze(
	ports: { snoozes: NotificationSnoozePort; whatsNext: WhatsNextRepositoryPort; clock: Clock },
	input: { actionId: string; choice: string; expectedItemId: string }
): NotificationSnooze {
	const date = snoozeDate(input.choice, ports.clock.todayIso());
	if (!date || !isValidSnoozeDate(date, ports.clock.todayIso())) throw new InvalidSnoozeDateError();
	const action = eligibleAction(ports, input.actionId, ports.clock.todayIso());
	if (!action || action.itemId !== input.expectedItemId) {
		throw new IneligibleSnoozeError();
	}
	return ports.snoozes.set({
		actionId: input.actionId,
		sourceDueDate: action.dueDate,
		snoozedUntil: date
	});
}

export function readSnooze(
	ports: { snoozes: NotificationSnoozePort; whatsNext: WhatsNextRepositoryPort; clock: Clock },
	actionId: string
): NotificationSnooze | null {
	const snooze = ports.snoozes.get(actionId);
	if (!snooze) return null;
	const action = eligibleAction(ports, actionId, ports.clock.todayIso());
	if (!action || action.dueDate !== snooze.sourceDueDate) {
		ports.snoozes.clearIfVersion(actionId, snooze.version);
		return null;
	}
	return snooze;
}

export function clearSnooze(
	ports: { snoozes: NotificationSnoozePort; whatsNext: WhatsNextRepositoryPort; clock: Clock },
	actionId: string,
	expectedItemId: string
): boolean {
	const action = eligibleAction(ports, actionId, ports.clock.todayIso());
	if (action && action.itemId !== expectedItemId) return false;
	const snooze = readSnooze(ports, actionId);
	return snooze ? ports.snoozes.clearIfVersion(actionId, snooze.version) : false;
}
