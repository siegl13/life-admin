import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { NotificationSnooze } from '$lib/domain/notify/snooze';

function map(row: Record<string, string>): NotificationSnooze {
	return {
		actionId: row.action_id,
		sourceDueDate: row.source_due_date,
		snoozedUntil: row.snoozed_until,
		version: row.version
	};
}

export function get(db: Database.Database, actionId: string): NotificationSnooze | null {
	const row = db.prepare('SELECT * FROM notification_snoozes WHERE action_id = ?').get(actionId) as
		Record<string, string> | undefined;
	return row ? map(row) : null;
}

export function list(db: Database.Database): NotificationSnooze[] {
	return db
		.prepare('SELECT * FROM notification_snoozes ORDER BY action_id')
		.all()
		.map((row) => map(row as Record<string, string>));
}

export function set(
	db: Database.Database,
	input: { actionId: string; sourceDueDate: string; snoozedUntil: string }
): NotificationSnooze {
	const snooze = { ...input, version: crypto.randomUUID() };
	db.prepare(
		`INSERT INTO notification_snoozes (action_id, source_due_date, snoozed_until, version)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(action_id) DO UPDATE SET source_due_date = excluded.source_due_date,
		 snoozed_until = excluded.snoozed_until, version = excluded.version`
	).run(snooze.actionId, snooze.sourceDueDate, snooze.snoozedUntil, snooze.version);
	return snooze;
}

export function clearIfVersion(db: Database.Database, actionId: string, version: string): boolean {
	return (
		db
			.prepare('DELETE FROM notification_snoozes WHERE action_id = ? AND version = ?')
			.run(actionId, version).changes === 1
	);
}

export function clearIneligible(db: Database.Database): number {
	return db
		.prepare(
			`DELETE FROM notification_snoozes
			 WHERE NOT EXISTS (
				 SELECT 1
				 FROM actions a
				 JOIN cycles c ON c.id = a.cycle_id
				 JOIN items i ON i.id = c.item_id
				 WHERE a.id = notification_snoozes.action_id
				   AND a.state = 'OPEN'
				   AND c.status = 'ACTIVE'
				   AND i.status = 'ACTIVE'
				   AND COALESCE(a.due_override_date, a.due_date) IS NOT NULL
				   AND NOT EXISTS (
					   SELECT 1
					   FROM action_dependencies ad
					   JOIN actions dependency ON dependency.id = ad.depends_on_action_id
					   WHERE ad.action_id = a.id
						 AND dependency.state NOT IN ('DONE', 'SKIPPED')
				   )
			 )`
		)
		.run().changes;
}
