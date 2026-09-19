import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { assertStagedInboxConsistency, InboxRestoreConsistencyError } from './inboxReconciliation';

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-inbox-reconcile-'));
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function insertInboxRow(bytes: Uint8Array): string {
	const id = randomUUID();
	const key = `${id.slice(0, 2)}/${id}`;
	const db = openDatabase(path.join(tmpDir, 'lifeadmin.sqlite'));
	db.prepare(
		`INSERT INTO inbox_documents
		 (id, storage_key, filename, mime_type, byte_size, sha256, suggestion_json, status, created_at, updated_at)
		 VALUES (?, ?, 'a.pdf', 'application/pdf', ?, ?, NULL, 'PENDING', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
	).run(id, key, bytes.byteLength, createHash('sha256').update(bytes).digest('hex'));
	db.close();
	return key;
}

it('rejects a staged Inbox row without its file', () => {
	insertInboxRow(new TextEncoder().encode('missing'));
	expect(() => assertStagedInboxConsistency(tmpDir)).toThrow(InboxRestoreConsistencyError);
});

it('rejects an orphaned staged Inbox file', () => {
	openDatabase(path.join(tmpDir, 'lifeadmin.sqlite')).close();
	const id = randomUUID();
	fs.mkdirSync(path.join(tmpDir, 'inbox', id.slice(0, 2)), { recursive: true });
	fs.writeFileSync(path.join(tmpDir, 'inbox', id.slice(0, 2), id), 'orphan');
	expect(() => assertStagedInboxConsistency(tmpDir)).toThrow(InboxRestoreConsistencyError);
});

it('accepts matching staged Inbox metadata and file bytes', () => {
	const bytes = new TextEncoder().encode('valid');
	const key = insertInboxRow(bytes);
	fs.mkdirSync(path.join(tmpDir, 'inbox', path.dirname(key)), { recursive: true });
	fs.writeFileSync(path.join(tmpDir, 'inbox', key), bytes);
	expect(() => assertStagedInboxConsistency(tmpDir)).not.toThrow();
});
