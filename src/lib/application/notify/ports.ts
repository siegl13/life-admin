import type { ReminderKind } from '$lib/domain/notify/reminders';
import type { NotificationSnooze } from '$lib/domain/notify/snooze';

export type NotificationChannel = 'NTFY' | 'SLACK';
export type DeliveryKind = ReminderKind | 'SNOOZED';

export interface NotificationMessage {
	title: string;
	body: string;
	clickUrl: string | null;
}

export interface NotificationChannelPort {
	send(message: NotificationMessage): Promise<void>;
}

export interface NotificationChannelsPort {
	get(channel: NotificationChannel): NotificationChannelPort | null;
}

export interface NotificationSettings {
	enabled: boolean;
	channel: NotificationChannel;
	selectedChannelConfigured: boolean;
	leadDays: number;
	minimalContent: boolean;
}

export interface RetryableDelivery {
	actionId: string;
	kind: DeliveryKind;
	targetDate: string;
	channel: NotificationChannel;
}

export interface RetryableDeliveryKey {
	actionId: string;
	kind: DeliveryKind;
	targetDate: string;
}

export interface NotificationDeliveryRepositoryPort {
	claim(input: {
		itemId: string;
		actionId: string;
		kind: DeliveryKind;
		targetDate: string;
		channel: NotificationChannel;
		createdAt: string;
	}): boolean;
	markSent(
		actionId: string,
		kind: DeliveryKind,
		targetDate: string,
		channel: NotificationChannel,
		nowIso: string
	): void;
	markAttemptFailed(
		actionId: string,
		kind: ReminderKind,
		targetDate: string,
		channel: NotificationChannel,
		reason: string,
		maxAttempts: number,
		nowIso: string
	): void;
	markSentAndConsumeSnooze(input: {
		actionId: string;
		targetDate: string;
		channel: NotificationChannel;
		nowIso: string;
		version: string;
	}): boolean;
	listRetryable(
		maxAttempts: number,
		limit: number,
		eligible: readonly RetryableDeliveryKey[]
	): RetryableDelivery[];
	getLastFailure(): { reason: string; failedAt: string } | null;
}

export interface NotificationSettingsPort {
	getSettings(): NotificationSettings;
}

export interface NotificationSnoozePort {
	get(actionId: string): NotificationSnooze | null;
	set(input: { actionId: string; sourceDueDate: string; snoozedUntil: string }): NotificationSnooze;
	clearIfVersion(actionId: string, version: string): boolean;
	list(): NotificationSnooze[];
	clearIneligible?(): number;
}
