import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import {
	AttachmentsWithoutTableError,
	reconcileStagedAttachments
} from './attachmentReconciliation';

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-reconcile-'));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function insertAttachmentRow(
	dbPath: string,
	row: { id: string; storageKey: string; bytes: Uint8Array }
): void {
	const db = openDatabase(dbPath);
	db.prepare(
		`INSERT INTO items (id, title, created_at, updated_at) VALUES ('item-1', 'Item', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
	).run();
	db.prepare(
		`INSERT INTO attachments (id, item_id, filename, storage_key, mime_type, byte_size, sha256, uploaded_at)
		 VALUES (?, 'item-1', 'a.pdf', ?, 'application/pdf', ?, ?, '2026-01-01T00:00:00.000Z')`
	).run(
		row.id,
		row.storageKey,
		row.bytes.byteLength,
		createHash('sha256').update(row.bytes).digest('hex')
	);
	db.close();
}

describe('reconcileStagedAttachments', () => {
	it('returns an empty report when the staged database has no attachments', () => {
		const dbPath = path.join(tmpDir, 'lifeadmin.sqlite');
		openDatabase(dbPath).close();
		expect(reconcileStagedAttachments(tmpDir)).toEqual({
			missingFiles: [],
			mismatchedFiles: [],
			orphanedFiles: [],
			invalidStorageKeys: []
		});
	});

	it('returns an empty report and does not throw when there is no staged database at all', () => {
		expect(reconcileStagedAttachments(tmpDir)).toEqual({
			missingFiles: [],
			mismatchedFiles: [],
			orphanedFiles: [],
			invalidStorageKeys: []
		});
	});

	it('reports a row whose file is missing', () => {
		const dbPath = path.join(tmpDir, 'lifeadmin.sqlite');
		const id = randomUUID();
		insertAttachmentRow(dbPath, {
			id: 'att-missing',
			storageKey: `${id.slice(0, 2)}/${id}`,
			bytes: new TextEncoder().encode('x')
		});
		expect(reconcileStagedAttachments(tmpDir).missingFiles).toEqual(['att-missing']);
	});

	it('reports a row whose file no longer matches its recorded checksum', () => {
		const dbPath = path.join(tmpDir, 'lifeadmin.sqlite');
		const id = randomUUID();
		const key = `${id.slice(0, 2)}/${id}`;
		insertAttachmentRow(dbPath, {
			id: 'att-mismatch',
			storageKey: key,
			bytes: new TextEncoder().encode('original bytes')
		});
		fs.mkdirSync(path.join(tmpDir, 'attachments', id.slice(0, 2)), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, 'attachments', key), 'tampered bytes');
		expect(reconcileStagedAttachments(tmpDir).mismatchedFiles).toEqual(['att-mismatch']);
	});

	it('reports a file with no referencing row as orphaned', () => {
		const dbPath = path.join(tmpDir, 'lifeadmin.sqlite');
		openDatabase(dbPath).close();
		const id = randomUUID();
		fs.mkdirSync(path.join(tmpDir, 'attachments', id.slice(0, 2)), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, 'attachments', id.slice(0, 2), id), 'nobody references me');
		expect(reconcileStagedAttachments(tmpDir).orphanedFiles).toEqual([`${id.slice(0, 2)}/${id}`]);
	});

	it('reports nothing when every row has a matching, correct file', () => {
		const dbPath = path.join(tmpDir, 'lifeadmin.sqlite');
		const bytes = new TextEncoder().encode('consistent bytes');
		const id = randomUUID();
		const key = `${id.slice(0, 2)}/${id}`;
		insertAttachmentRow(dbPath, { id: 'att-ok', storageKey: key, bytes });
		fs.mkdirSync(path.join(tmpDir, 'attachments', id.slice(0, 2)), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, 'attachments', key), Buffer.from(bytes));
		expect(reconcileStagedAttachments(tmpDir)).toEqual({
			missingFiles: [],
			mismatchedFiles: [],
			orphanedFiles: [],
			invalidStorageKeys: []
		});
	});

	describe('pre-Slice-7 compatibility (no attachments table)', () => {
		it('treats a database with no attachments table as a valid, empty-attachment backup', () => {
			// Simulate a pre-Slice-7 snapshot directly: drop the table a fresh
			// openDatabase() would otherwise create via migrations.
			const dbPath = path.join(tmpDir, 'lifeadmin.sqlite');
			const db = openDatabase(dbPath);
			db.exec('DROP TABLE attachments');
			db.close();

			expect(reconcileStagedAttachments(tmpDir)).toEqual({
				missingFiles: [],
				mismatchedFiles: [],
				orphanedFiles: [],
				invalidStorageKeys: []
			});
		});

		it('rejects as inconsistent when there is no attachments table but staged files exist anyway', () => {
			const dbPath = path.join(tmpDir, 'lifeadmin.sqlite');
			const db = openDatabase(dbPath);
			db.exec('DROP TABLE attachments');
			db.close();
			fs.mkdirSync(path.join(tmpDir, 'attachments', 'ab'), { recursive: true });
			fs.writeFileSync(path.join(tmpDir, 'attachments', 'ab', 'stray-file'), 'nobody made me');

			expect(() => reconcileStagedAttachments(tmpDir)).toThrow(AttachmentsWithoutTableError);
		});
	});

	describe('untrusted storage_key', () => {
		it('reports rather than resolves a traversal or absolute storage_key, and never reads outside staging', () => {
			const dbPath = path.join(tmpDir, 'lifeadmin.sqlite');
			const db = openDatabase(dbPath);
			db.prepare(
				`INSERT INTO items (id, title, created_at, updated_at) VALUES ('item-1', 'Item', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
			).run();
			for (const [id, key] of [
				['att-traversal', '../../../../etc/passwd'],
				['att-absolute', '/etc/passwd']
			]) {
				db.prepare(
					`INSERT INTO attachments (id, item_id, filename, storage_key, mime_type, byte_size, sha256, uploaded_at)
					 VALUES (?, 'item-1', 'a.pdf', ?, 'application/pdf', 10, ?, '2026-01-01T00:00:00.000Z')`
				).run(id, key, 'a'.repeat(64));
			}
			db.close();

			const report = reconcileStagedAttachments(tmpDir);
			expect(report.invalidStorageKeys.sort()).toEqual(['att-absolute', 'att-traversal']);
			expect(report.missingFiles).toEqual([]);
			expect(report.mismatchedFiles).toEqual([]);
		});
	});
});
