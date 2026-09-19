import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import { emptyMaterializationPlan } from '$lib/domain/playbook/materialize';
import { createItem, setItemStatus } from './itemRepository';
import { getActiveCycle } from './cycleRepository';
import * as attachmentRepository from './attachmentRepository';
import { ItemNotWritableError } from './writeGuards';
import type { Attachment } from '$lib/domain/attachment/attachment';

let tmpDir: string;
let db: Database.Database;
let itemId: string;
let cycleId: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-attachment-repo-'));
	db = openDatabase(path.join(tmpDir, 'test.sqlite'));
	const item = createItem(db, {
		title: 'Test item',
		note: null,
		playbook: null,
		materialization: emptyMaterializationPlan()
	});
	itemId = item.id;
	cycleId = getActiveCycle(db, itemId)!.id;
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function fixture(overrides: Partial<Attachment> = {}): Attachment {
	return {
		id: overrides.id ?? 'att-1',
		itemId,
		cycleId,
		filename: 'invoice.pdf',
		displayName: null,
		storageKey: `ab/${overrides.id ?? 'att-1'}`,
		mimeType: 'application/pdf',
		byteSize: 100,
		sha256: 'a'.repeat(64),
		uploadedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

describe('attachmentRepository', () => {
	it('inserts and reads a row back unchanged', () => {
		attachmentRepository.insert(db, fixture());
		expect(attachmentRepository.getById(db, 'att-1')).toEqual(fixture());
	});

	it('allows two attachments with the same filename on one item', () => {
		attachmentRepository.insert(
			db,
			fixture({ id: 'att-1', uploadedAt: '2026-01-01T00:00:00.000Z' })
		);
		attachmentRepository.insert(
			db,
			fixture({ id: 'att-2', uploadedAt: '2026-01-02T00:00:00.000Z' })
		);
		expect(attachmentRepository.listByItem(db, itemId)).toHaveLength(2);
	});

	it('renames only display_name and rejects archived or mismatched items', () => {
		const original = fixture();
		attachmentRepository.insert(db, original);
		expect(attachmentRepository.rename(db, itemId, original.id, 'Readable name')).toEqual({
			...original,
			displayName: 'Readable name'
		});
		expect(attachmentRepository.rename(db, 'other-item', original.id, 'Wrong')).toBeNull();
		setItemStatus(db, itemId, 'ARCHIVED');
		expect(() => attachmentRepository.rename(db, itemId, original.id, 'Blocked')).toThrow(
			ItemNotWritableError
		);
		expect(attachmentRepository.getById(db, original.id)).toEqual({
			...original,
			displayName: 'Readable name'
		});
	});

	it('enforces the 120-code-point display-name bound in SQLite', () => {
		expect(() =>
			attachmentRepository.insert(db, fixture({ displayName: 'x'.repeat(121) }))
		).toThrow();
	});

	it('lists by item newest first', () => {
		attachmentRepository.insert(
			db,
			fixture({ id: 'att-1', uploadedAt: '2026-01-01T00:00:00.000Z' })
		);
		attachmentRepository.insert(
			db,
			fixture({ id: 'att-2', uploadedAt: '2026-01-02T00:00:00.000Z' })
		);
		expect(attachmentRepository.listByItem(db, itemId).map((a) => a.id)).toEqual([
			'att-2',
			'att-1'
		]);
	});

	it('lists by cycle', () => {
		attachmentRepository.insert(db, fixture());
		expect(attachmentRepository.listByCycle(db, cycleId).map((a) => a.id)).toEqual(['att-1']);
	});

	it('counts attachments for an item', () => {
		attachmentRepository.insert(db, fixture({ id: 'att-1' }));
		attachmentRepository.insert(db, fixture({ id: 'att-2' }));
		expect(attachmentRepository.countByItem(db, itemId)).toBe(2);
	});

	it('deleteById removes the row and returns it, and is a no-op for a missing id', () => {
		attachmentRepository.insert(db, fixture());
		expect(attachmentRepository.deleteById(db, 'att-1')?.id).toBe('att-1');
		expect(attachmentRepository.getById(db, 'att-1')).toBeNull();
		expect(attachmentRepository.deleteById(db, 'att-1')).toBeNull();
	});

	it('lists storage keys for an item', () => {
		attachmentRepository.insert(db, fixture({ id: 'att-1' }));
		attachmentRepository.insert(db, fixture({ id: 'att-2' }));
		expect(attachmentRepository.listStorageKeysForItem(db, itemId).sort()).toEqual([
			'ab/att-1',
			'ab/att-2'
		]);
	});

	it('deleting the item cascades its attachment rows away', () => {
		attachmentRepository.insert(db, fixture());
		db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
		expect(attachmentRepository.getById(db, 'att-1')).toBeNull();
	});

	it('deleting the cycle sets cycle_id to NULL and keeps the attachment row', () => {
		attachmentRepository.insert(db, fixture());
		db.prepare('DELETE FROM cycles WHERE id = ?').run(cycleId);
		expect(attachmentRepository.getById(db, 'att-1')).toMatchObject({ id: 'att-1', cycleId: null });
	});

	it('rejects a duplicate storage_key at the database level', () => {
		attachmentRepository.insert(db, fixture({ id: 'att-1', storageKey: 'ab/shared' }));
		expect(() =>
			attachmentRepository.insert(db, fixture({ id: 'att-2', storageKey: 'ab/shared' }))
		).toThrow();
	});

	it('refuses to insert once the item is archived, and inserts no row (Slice 8 review, finding 2: no Attachment may land on an archived item, however slow the upload)', () => {
		setItemStatus(db, itemId, 'ARCHIVED');
		expect(() => attachmentRepository.insert(db, fixture())).toThrow(ItemNotWritableError);
		expect(attachmentRepository.listByItem(db, itemId)).toEqual([]);
	});

	it('refuses to delete once the item is archived, and keeps the row (Slice 8 review, finding 2)', () => {
		attachmentRepository.insert(db, fixture());
		setItemStatus(db, itemId, 'ARCHIVED');
		expect(() => attachmentRepository.deleteById(db, 'att-1')).toThrow(ItemNotWritableError);
		expect(attachmentRepository.getById(db, 'att-1')).not.toBeNull();
	});
});
