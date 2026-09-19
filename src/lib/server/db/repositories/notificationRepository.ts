import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
	NotificationChannel,
	RetryableDelivery,
	RetryableDeliveryKey
} from '$lib/application/notify/ports';
import type { ReminderKind } from '$lib/domain/notify/reminders';

/**
 * The UNIQUE(action_id, kind, target_date, channel) key means a reminder
 * already sent for a due date is never sent twice for that same date,
 * even if the action was completed and then reopened in the meantime.
 * Intentional anti-spam, not a bug: reopening an action does not clear
 * its prior deliveries.
 */
export function claim(
	db: Database.Database,
	input: {
		itemId: string;
		actionId: string;
		kind: ReminderKind;
		targetDate: string;
		channel: NotificationChannel;
		createdAt: string;
	}
): boolean {
	const result = db
		.prepare(
			`INSERT INTO notification_deliveries
		 (id, item_id, action_id, kind, target_date, channel, status, attempts, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?)
		 ON CONFLICT (action_id, kind, target_date, channel) DO NOTHING`
		)
		.run(
			crypto.randomUUID(),
			input.itemId,
			input.actionId,
			input.kind,
			input.targetDate,
			input.channel,
			input.createdAt
		);
	return result.changes === 1;
}

export function markSent(
	db: Database.Database,
	actionId: string,
	kind: ReminderKind,
	targetDate: string,
	channel: NotificationChannel,
	nowIso: string
): void {
	db.prepare(
		`UPDATE notification_deliveries SET status = 'SENT', sent_at = ?, last_error = NULL
		WHERE action_id = ? AND kind = ? AND target_date = ? AND channel = ? AND status = 'PENDING'`
	).run(nowIso, actionId, kind, targetDate, channel);
}

export function markAttemptFailed(
	db: Database.Database,
	actionId: string,
	kind: ReminderKind,
	targetDate: string,
	channel: NotificationChannel,
	reason: string,
	maxAttempts: number,
	nowIso: string
): void {
	db.prepare(
		`UPDATE notification_deliveries
		SET attempts = attempts + 1,
			status = CASE WHEN attempts + 1 >= ? THEN 'FAILED' ELSE 'PENDING' END,
			last_error = ?,
			failed_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE failed_at END
		WHERE action_id = ? AND kind = ? AND target_date = ? AND channel = ? AND status = 'PENDING'`
	).run(maxAttempts, reason, maxAttempts, nowIso, actionId, kind, targetDate, channel);
}

export function listRetryable(
	db: Database.Database,
	maxAttempts: number,
	limit: number,
	eligible: readonly RetryableDeliveryKey[]
): RetryableDelivery[] {
	if (eligible.length === 0) return [];
	const values = eligible.map(() => '(?, ?, ?)').join(', ');
	const params = eligible.flatMap((delivery) => [
		delivery.actionId,
		delivery.kind,
		delivery.targetDate
	]);
	return db
		.prepare(
			`WITH eligible(action_id, kind, target_date) AS (VALUES ${values})
			SELECT d.action_id, d.kind, d.target_date, d.channel
		FROM notification_deliveries d
		JOIN eligible e ON e.action_id = d.action_id AND e.kind = d.kind AND e.target_date = d.target_date
		WHERE d.status = 'PENDING' AND d.attempts < ?
		ORDER BY d.created_at ASC LIMIT ?`
		)
		.all(...params, maxAttempts, limit)
		.map((row) => {
			const r = row as Record<string, string>;
			return {
				actionId: r.action_id,
				kind: r.kind as ReminderKind,
				targetDate: r.target_date,
				channel: r.channel as NotificationChannel
			};
		});
}

export function getLastFailure(db: Database.Database): { reason: string; failedAt: string } | null {
	const row = db
		.prepare(
			`SELECT last_error, failed_at FROM notification_deliveries
		WHERE status = 'FAILED' ORDER BY failed_at DESC LIMIT 1`
		)
		.get() as { last_error: string; failed_at: string } | undefined;
	return row ? { reason: row.last_error, failedAt: row.failed_at } : null;
}
