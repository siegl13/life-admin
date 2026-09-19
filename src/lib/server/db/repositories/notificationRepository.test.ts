import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyMaterializationPlan } from '$lib/domain/playbook/materialize';
import { openDatabase } from '../database';
import { addManualAction } from './actionRepository';
import { getActiveCycle, startNextCycle } from './cycleRepository';
import { createItem } from './itemRepository';
import { claim, listRetryable, markAttemptFailed, markSent } from './notificationRepository';

let db: Database.Database;
let tmpDir: string;
let itemId: string;
let actionId: string;

function createAction(label: string): string {
	const item = createItem(db, {
		title: label,
		note: null,
		playbook: null,
		materialization: emptyMaterializationPlan()
	});
	const cycle = getActiveCycle(db, item.id)!;
	return addManualAction(db, cycle.id, { label, dueDate: '2026-06-10' }).id;
}

function claimDelivery(actionId: string, createdAt = '2026-06-03T09:00:00.000Z'): boolean {
	return claim(db, {
		itemId,
		actionId,
		kind: 'DUE_SOON',
		targetDate: '2026-06-10',
		channel: 'NTFY',
		createdAt
	});
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-notification-repo-'));
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

describe('notificationRepository', () => {
	it('uses the delivery key as an atomic duplicate check', () => {
		expect(claimDelivery(actionId)).toBe(true);
		expect(claimDelivery(actionId)).toBe(false);
	});

	it('marks a successful pending delivery as sent', () => {
		claimDelivery(actionId);
		markSent(db, actionId, 'DUE_SOON', '2026-06-10', 'NTFY', '2026-06-03T09:01:00.000Z');
		expect(db.prepare('SELECT status, sent_at FROM notification_deliveries').get()).toEqual({
			status: 'SENT',
			sent_at: '2026-06-03T09:01:00.000Z'
		});
	});

	it('caps failures and removes the row from retries after the third attempt', () => {
		claimDelivery(actionId);
		for (let attempt = 0; attempt < 3; attempt++) {
			markAttemptFailed(
				db,
				actionId,
				'DUE_SOON',
				'2026-06-10',
				'NTFY',
				'http_502',
				3,
				`2026-06-03T09:0${attempt}:00.000Z`
			);
		}
		expect(db.prepare('SELECT status, attempts FROM notification_deliveries').get()).toEqual({
			status: 'FAILED',
			attempts: 3
		});
		expect(
			listRetryable(db, 3, 20, [{ actionId, kind: 'DUE_SOON', targetDate: '2026-06-10' }])
		).toEqual([]);
	});

	it('filters stale rows before applying the retry limit', () => {
		for (let index = 0; index < 20; index++) {
			const staleActionId = createAction(`Stale ${index}`);
			claimDelivery(staleActionId, `2026-06-03T08:${String(index).padStart(2, '0')}:00.000Z`);
		}
		claimDelivery(actionId, '2026-06-03T09:00:00.000Z');

		expect(
			listRetryable(db, 3, 20, [{ actionId, kind: 'DUE_SOON', targetDate: '2026-06-10' }])
		).toEqual([{ actionId, kind: 'DUE_SOON', targetDate: '2026-06-10', channel: 'NTFY' }]);
	});

	it('returns eligible retries in delivery creation order', () => {
		const laterActionId = createAction('Later retry');
		claimDelivery(laterActionId, '2026-06-03T10:00:00.000Z');
		claimDelivery(actionId, '2026-06-03T09:00:00.000Z');

		expect(
			listRetryable(db, 3, 20, [
				{ actionId: laterActionId, kind: 'DUE_SOON', targetDate: '2026-06-10' },
				{ actionId, kind: 'DUE_SOON', targetDate: '2026-06-10' }
			])
		).toEqual([
			{ actionId, kind: 'DUE_SOON', targetDate: '2026-06-10', channel: 'NTFY' },
			{ actionId: laterActionId, kind: 'DUE_SOON', targetDate: '2026-06-10', channel: 'NTFY' }
		]);
	});

	it('keeps delivery history after its action cycle is completed', () => {
		claimDelivery(actionId);
		const cycle = getActiveCycle(db, itemId)!;
		startNextCycle(db, {
			itemId,
			completingCycleId: cycle.id,
			playbookVersion: null,
			fields: [],
			events: [],
			actions: []
		});

		expect(db.prepare('SELECT COUNT(*) AS count FROM notification_deliveries').get()).toEqual({
			count: 1
		});
	});

	it('cascades delivery history when its item is deleted', () => {
		claimDelivery(actionId);
		db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
		expect(db.prepare('SELECT COUNT(*) AS count FROM notification_deliveries').get()).toEqual({
			count: 0
		});
	});
});
