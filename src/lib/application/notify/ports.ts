import type { ReminderKind } from '$lib/domain/notify/reminders';

export type NotificationChannel = 'NTFY' | 'SLACK';

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
	kind: ReminderKind;
	targetDate: string;
	channel: NotificationChannel;
}

export interface RetryableDeliveryKey {
	actionId: string;
	kind: ReminderKind;
	targetDate: string;
}

export interface NotificationDeliveryRepositoryPort {
	claim(input: {
		itemId: string;
		actionId: string;
		kind: ReminderKind;
		targetDate: string;
		channel: NotificationChannel;
		createdAt: string;
	}): boolean;
	markSent(
		actionId: string,
		kind: ReminderKind,
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
