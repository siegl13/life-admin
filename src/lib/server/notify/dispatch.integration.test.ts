import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchDueReminders } from '$lib/application/notify/dispatchDueReminders';
import type { NotificationChannel, NotificationSettings } from '$lib/application/notify/ports';
import type { ReminderKind } from '$lib/domain/notify/reminders';
import { emptyMaterializationPlan } from '$lib/domain/playbook/materialize';
import { openDatabase } from '../db/database';
import {
	addManualAction,
	setActionDueOverride,
	setActionState
} from '../db/repositories/actionRepository';
import { getActiveCycle } from '../db/repositories/cycleRepository';
import { createItem } from '../db/repositories/itemRepository';
import * as deliveries from '../db/repositories/notificationRepository';
import { loadWhatsNextItems } from '../db/repositories/whatsNextRepository';

let db: Database.Database;
let tmpDir: string;
let itemId: string;
let actionId: string;

const clock = {
	todayIso: () => '2026-06-03',
	nowIso: () => '2026-06-03T09:00:00.000Z',
	localHour: () => 9
};

function createPorts(settings: NotificationSettings, send = vi.fn(async () => {})) {
	return {
		settings: { getSettings: () => settings },
		deliveries: {
			claim: (input: Parameters<typeof deliveries.claim>[1]) => deliveries.claim(db, input),
			markSent: (
				actionId: string,
				kind: ReminderKind,
				targetDate: string,
				channel: NotificationChannel,
				nowIso: string
			) => deliveries.markSent(db, actionId, kind, targetDate, channel, nowIso),
			markAttemptFailed: (
				actionId: string,
				kind: ReminderKind,
				targetDate: string,
				channel: NotificationChannel,
				reason: string,
				maxAttempts: number,
				nowIso: string
			) =>
				deliveries.markAttemptFailed(
					db,
					actionId,
					kind,
					targetDate,
					channel,
					reason,
					maxAttempts,
					nowIso
				),
			listRetryable: (
				maxAttempts: number,
				limit: number,
				eligible: Parameters<typeof deliveries.listRetryable>[3]
			) => deliveries.listRetryable(db, maxAttempts, limit, eligible),
			getLastFailure: () => deliveries.getLastFailure(db)
		},
		channels: { get: () => ({ send }) },
		whatsNext: { loadItems: () => loadWhatsNextItems(db) },
		clock,
		origin: null
	};
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-notification-dispatch-'));
	db = openDatabase(path.join(tmpDir, 'test.sqlite'));
	const item = createItem(db, {
		title: 'Item',
		note: null,
		playbook: null,
		materialization: emptyMaterializationPlan()
	});
	itemId = item.id;
	actionId = addManualAction(db, getActiveCycle(db, item.id)!.id, {
		label: 'Action',
		dueDate: '2026-06-10'
	}).id;
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('dispatchDueReminders with real persistence', () => {
	it('does not send a reminder twice after a fresh dispatch invocation', async () => {
		const send = vi.fn(async () => {});
		const settings = {
			enabled: true,
			channel: 'NTFY' as const,
			selectedChannelConfigured: true,
			leadDays: 7,
			minimalContent: false
		};
		await dispatchDueReminders(createPorts(settings, send));
		await dispatchDueReminders(createPorts(settings, send));
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('does not send an overdue reminder after the action is completed', async () => {
		const send = vi.fn(async () => {});
		const settings = {
			enabled: true,
			channel: 'NTFY' as const,
			selectedChannelConfigured: true,
			leadDays: 7,
			minimalContent: false
		};
		await dispatchDueReminders(createPorts(settings, send));
		setActionState(db, itemId, actionId, 'DONE');
		await dispatchDueReminders(createPorts(settings, send));
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('does not resend a delivery when the lead time changes', async () => {
		const send = vi.fn(async () => {});
		await dispatchDueReminders(
			createPorts(
				{
					enabled: true,
					channel: 'NTFY',
					selectedChannelConfigured: true,
					leadDays: 7,
					minimalContent: false
				},
				send
			)
		);
		await dispatchDueReminders(
			createPorts(
				{
					enabled: true,
					channel: 'NTFY',
					selectedChannelConfigured: true,
					leadDays: 14,
					minimalContent: false
				},
				send
			)
		);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('sends one new reminder when a derived due date changes', async () => {
		db.prepare('DELETE FROM actions WHERE id = ?').run(actionId);
		const cycleId = getActiveCycle(db, itemId)!.id;
		actionId = 'derived-action';
		db.prepare(
			`INSERT INTO actions
			 (id, cycle_id, action_key, label, state, due_kind, due_event_key, due_offset, due_date, position, created_at)
			 VALUES (?, ?, 'derived', 'Derived action', 'OPEN', 'DERIVED', 'event', '{}', '2026-06-10', 0, ?)`
		).run(actionId, cycleId, clock.nowIso());
		const send = vi.fn(async () => {});
		const settings = {
			enabled: true,
			channel: 'NTFY' as const,
			selectedChannelConfigured: true,
			leadDays: 7,
			minimalContent: false
		};

		await dispatchDueReminders(createPorts(settings, send));
		setActionDueOverride(db, itemId, actionId, '2026-06-09');
		await dispatchDueReminders(createPorts(settings, send));
		await dispatchDueReminders(createPorts(settings, send));
		expect(send).toHaveBeenCalledTimes(2);
	});

	it('stops retrying after three failed attempts', async () => {
		const send = vi.fn(async () => {
			throw new Error('http_502');
		});
		const settings = {
			enabled: true,
			channel: 'NTFY' as const,
			selectedChannelConfigured: true,
			leadDays: 7,
			minimalContent: false
		};
		for (let attempt = 0; attempt < 4; attempt++)
			await dispatchDueReminders(createPorts(settings, send));
		expect(send).toHaveBeenCalledTimes(3);
		expect(db.prepare('SELECT status, attempts FROM notification_deliveries').get()).toEqual({
			status: 'FAILED',
			attempts: 3
		});
	});
});
