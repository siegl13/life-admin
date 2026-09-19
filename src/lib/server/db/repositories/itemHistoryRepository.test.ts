import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import { insert, listByItem, countByItem, deleteForItem } from './itemHistoryRepository';

const itemId = '10000000-0000-4000-8000-000000000001';
let directory: string;
let db: Database.Database;

beforeEach(() => {
	directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-history-'));
	db = openDatabase(path.join(directory, 'test.sqlite'));
	db.prepare(
		`INSERT INTO items (id, title, status, created_at, updated_at)
		 VALUES (?, 'Test Item', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
	).run(itemId);
});

afterEach(() => {
	db.close();
	fs.rmSync(directory, { recursive: true, force: true });
});

describe('itemHistoryRepository', () => {
	it('inserts and lists events in reverse chronological order', () => {
		insert(db, {
			id: 'event-1',
			itemId,
			actorKind: 'OWNER',
			eventType: 'FIELD_CHANGED',
			payload: '{"fieldKey":"notes"}',
			createdAt: '2026-01-01T10:00:00.000Z'
		});
		insert(db, {
			id: 'event-2',
			itemId,
			actorKind: 'SYSTEM',
			eventType: 'CYCLE_STARTED',
			payload: '{"cycleId":"c1","sequence":1}',
			createdAt: '2026-01-01T11:00:00.000Z'
		});

		const events = listByItem(db, itemId, 10, 0);
		expect(events).toHaveLength(2);
		expect(events[0].id).toBe('event-2');
		expect(events[1].id).toBe('event-1');
	});

	it('respects limit and offset', () => {
		for (let i = 0; i < 5; i++) {
			insert(db, {
				id: `event-${i}`,
				itemId,
				actorKind: 'OWNER',
				eventType: 'FIELD_CHANGED',
				payload: '{}',
				createdAt: `2026-01-0${i + 1}T00:00:00.000Z`
			});
		}

		const page1 = listByItem(db, itemId, 2, 0);
		expect(page1).toHaveLength(2);

		const page2 = listByItem(db, itemId, 2, 2);
		expect(page2).toHaveLength(2);

		const page3 = listByItem(db, itemId, 2, 4);
		expect(page3).toHaveLength(1);
	});

	it('counts events for an item', () => {
		expect(countByItem(db, itemId)).toBe(0);

		insert(db, {
			id: 'event-1',
			itemId,
			actorKind: 'OWNER',
			eventType: 'FIELD_CHANGED',
			payload: '{}',
			createdAt: '2026-01-01T00:00:00.000Z'
		});
		expect(countByItem(db, itemId)).toBe(1);

		insert(db, {
			id: 'event-2',
			itemId,
			actorKind: 'OWNER',
			eventType: 'ACTION_COMPLETED',
			payload: '{}',
			createdAt: '2026-01-02T00:00:00.000Z'
		});
		expect(countByItem(db, itemId)).toBe(2);
	});

	it('deletes events for an item', () => {
		insert(db, {
			id: 'event-1',
			itemId,
			actorKind: 'OWNER',
			eventType: 'FIELD_CHANGED',
			payload: '{}',
			createdAt: '2026-01-01T00:00:00.000Z'
		});
		expect(countByItem(db, itemId)).toBe(1);

		const deleted = deleteForItem(db, itemId);
		expect(deleted).toBe(1);
		expect(countByItem(db, itemId)).toBe(0);
	});
});
