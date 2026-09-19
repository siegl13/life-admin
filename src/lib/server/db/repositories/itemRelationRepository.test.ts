import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import {
	countRelated,
	deleteForItem,
	get,
	link,
	listCandidates,
	listRelated,
	unlink
} from './itemRelationRepository';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const C = '10000000-0000-4000-8000-000000000003';
let directory: string;
let db: Database.Database;

function item(id: string, title: string, status = 'ACTIVE', updatedAt = '2026-01-01T00:00:00Z') {
	db.prepare(
		`INSERT INTO items (id, title, status, created_at, updated_at, archived_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).run(id, title, status, updatedAt, updatedAt, status === 'ARCHIVED' ? updatedAt : null);
}

beforeEach(() => {
	directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-relations-'));
	db = openDatabase(path.join(directory, 'test.sqlite'));
	item(A, 'Current');
	item(B, 'Zulu', 'ACTIVE', '2026-02-01T00:00:00Z');
	item(C, 'Alpha', 'ACTIVE', '2026-03-01T00:00:00Z');
});

afterEach(() => {
	db.close();
	fs.rmSync(directory, { recursive: true, force: true });
});

describe('itemRelationRepository', () => {
	it('stores one canonical pair, reads both directions, and rejects a duplicate', () => {
		expect(link(db, B, A, '2026-01-01T00:00:00Z')).toBe('LINKED');
		expect(get(db, A, B)).toMatchObject({ itemAId: A, itemBId: B });
		expect(link(db, A, B, 'later')).toBe('DUPLICATE');
		expect(listRelated(db, A).map((entry) => entry.id)).toEqual([B]);
		expect(listRelated(db, B).map((entry) => entry.id)).toEqual([A]);
	});

	it('lists relations alphabetically and unlinks without changing either item', () => {
		link(db, A, B, 'now');
		link(db, A, C, 'now');
		expect(listRelated(db, A).map((entry) => entry.title)).toEqual(['Alpha', 'Zulu']);
		expect(unlink(db, A, B)).toBe('UNLINKED');
		expect(countRelated(db, A)).toBe(1);
		expect(db.prepare('SELECT count(*) AS count FROM items').get()).toEqual({ count: 3 });
	});

	it('rejects missing or archived targets and an archived source atomically', () => {
		expect(link(db, A, '10000000-0000-4000-8000-000000000099', 'now')).toBe('MISSING_ITEM');
		db.prepare("UPDATE items SET status = 'ARCHIVED', archived_at = 'now' WHERE id = ?").run(B);
		expect(link(db, A, B, 'now')).toBe('MISSING_ITEM');
		db.prepare("UPDATE items SET status = 'ACTIVE', archived_at = NULL WHERE id = ?").run(B);
		db.prepare("UPDATE items SET status = 'ARCHIVED', archived_at = 'now' WHERE id = ?").run(A);
		expect(link(db, A, B, 'now')).toBe('ARCHIVED_ITEM');
		expect(countRelated(db, A)).toBe(0);
	});

	it('does not reveal target existence when an archived source tries to unlink', () => {
		link(db, A, B, 'now');
		db.prepare("UPDATE items SET status = 'ARCHIVED', archived_at = 'now' WHERE id = ?").run(A);

		expect(unlink(db, A, B)).toBe('ARCHIVED_ITEM');
		expect(unlink(db, A, '10000000-0000-4000-8000-000000000099')).toBe('ARCHIVED_ITEM');
		expect(countRelated(db, A)).toBe(1);
	});

	it('returns only active candidates, excludes self, searches titles, and marks links', () => {
		link(db, A, B, 'now');
		item('10000000-0000-4000-8000-000000000004', 'Archived Alpha', 'ARCHIVED');
		expect(listCandidates(db, A, '', 5).map((entry) => entry.id)).toEqual([C, B]);
		expect(listCandidates(db, A, 'zulu', 20)[0]).toMatchObject({ id: B, alreadyLinked: true });
		expect(listCandidates(db, A, C.slice(-4), 20)).toEqual([]);
	});

	it('caps searches at twenty and orders equal titles by item id', () => {
		for (let number = 4; number <= 25; number++) {
			item(`10000000-0000-4000-8000-${String(number).padStart(12, '0')}`, 'Equal title');
		}

		const candidates = listCandidates(db, A, 'equal title', 99);
		expect(candidates).toHaveLength(20);
		expect(candidates.map((candidate) => candidate.id)).toEqual(
			Array.from(
				{ length: 20 },
				(_, index) => `10000000-0000-4000-8000-${String(index + 4).padStart(12, '0')}`
			)
		);
	});

	it('provides explicit relation cleanup for a future item deletion transaction', () => {
		link(db, A, B, 'now');
		link(db, A, C, 'now');
		expect(deleteForItem(db, A)).toBe(2);
		expect(countRelated(db, A)).toBe(0);
		expect(db.prepare('SELECT count(*) AS count FROM items').get()).toEqual({ count: 3 });
	});
});
