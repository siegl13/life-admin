import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyMaterializationPlan } from '$lib/domain/playbook/materialize';
import { openDatabase } from '../database';
import {
	claimAiRun,
	claimForRouting,
	completeRouting,
	deletePending,
	insert,
	recoverInterruptedRouting
} from './inboxRepository';
import { createItem } from './itemRepository';
import { DailyInboxAiLimitReachedError } from '$lib/application/ports';

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-inbox-repo-'));
	db = openDatabase(path.join(tmpDir, 'test.sqlite'));
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const now = '2026-01-01T00:00:00.000Z';
const sha256 = 'a'.repeat(64);

function insertClaimedDocument(): void {
	insertDocument('document-1', 'ROUTING');
}

function insertDocument(id: string, status: 'PENDING' | 'ROUTING' = 'PENDING'): void {
	insert(db, {
		id,
		storageKey: `aa/${id}`,
		filename: 'document.pdf',
		mimeType: 'application/pdf',
		byteSize: 5,
		sha256,
		suggestion: null,
		status,
		createdAt: now,
		updatedAt: now
	});
}

function claimRun(id: string, documentId: string, dailyLimit = 2): void {
	claimAiRun(db, {
		id,
		documentId,
		providerId: 'fake',
		modelId: 'fake-v1',
		createdAt: now,
		windowStartIso: '2025-12-31T00:00:00.000Z',
		dailyLimit
	});
}

function attachment(id = 'attachment-1') {
	return {
		id,
		filename: 'document.pdf',
		displayName: null,
		storageKey: 'bb/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
		mimeType: 'application/pdf' as const,
		byteSize: 5,
		sha256,
		uploadedAt: now
	};
}

describe('inbox routing repository', () => {
	it('rolls back a new item and retains the claimed Inbox row when attachment persistence fails', () => {
		const existing = createItem(db, {
			title: 'Existing',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});
		db.prepare(
			`INSERT INTO attachments (id, item_id, filename, storage_key, mime_type, byte_size, sha256, uploaded_at)
			 VALUES ('attachment-1', ?, 'existing.pdf', 'cc/cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'application/pdf', 5, ?, ?)`
		).run(existing.id, sha256, now);
		insertClaimedDocument();

		expect(() =>
			completeRouting(db, {
				documentId: 'document-1',
				destination: {
					kind: 'NEW',
					item: {
						title: 'Must roll back',
						note: null,
						playbook: null,
						materialization: emptyMaterializationPlan()
					}
				},
				attachment: attachment()
			})
		).toThrow();

		expect(db.prepare('SELECT COUNT(*) AS n FROM items').get()).toEqual({ n: 1 });
		expect(db.prepare('SELECT status FROM inbox_documents WHERE id = ?').get('document-1')).toEqual(
			{ status: 'ROUTING' }
		);
	});

	it('makes interrupted routing documents available again on startup recovery', () => {
		insertClaimedDocument();
		recoverInterruptedRouting(db, now);
		expect(db.prepare('SELECT status FROM inbox_documents WHERE id = ?').get('document-1')).toEqual(
			{ status: 'PENDING' }
		);
	});

	it('allows only one repository-level routing claim for a pending document', () => {
		insertDocument('document-1');
		expect(claimForRouting(db, 'document-1', now)?.status).toBe('ROUTING');
		expect(claimForRouting(db, 'document-1', now)).toBeNull();
	});

	it('retains an AI attempt and its daily-limit count after pending deletion', () => {
		insertDocument('document-1');
		claimRun('run-1', 'document-1', 1);

		expect(deletePending(db, 'document-1')?.id).toBe('document-1');
		expect(db.prepare('SELECT document_id FROM inbox_ai_runs WHERE id = ?').get('run-1')).toEqual({
			document_id: null
		});

		insertDocument('document-2');
		expect(() => claimRun('run-2', 'document-2', 1)).toThrow(DailyInboxAiLimitReachedError);
	});

	it('retains an AI attempt and its daily-limit count after successful routing', () => {
		const item = createItem(db, {
			title: 'Existing',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});
		insertClaimedDocument();
		claimRun('run-1', 'document-1', 1);

		expect(
			completeRouting(db, {
				documentId: 'document-1',
				destination: { kind: 'EXISTING', itemId: item.id },
				attachment: attachment()
			})
		).toMatchObject({ itemId: item.id });
		expect(db.prepare('SELECT document_id FROM inbox_ai_runs WHERE id = ?').get('run-1')).toEqual({
			document_id: null
		});

		insertDocument('document-2');
		expect(() => claimRun('run-2', 'document-2', 1)).toThrow(DailyInboxAiLimitReachedError);
	});

	it('rejects a stale existing-Item destination without removing the pending document', () => {
		insertClaimedDocument();

		expect(() =>
			completeRouting(db, {
				documentId: 'document-1',
				destination: { kind: 'EXISTING', itemId: 'missing-item' },
				attachment: attachment()
			})
		).toThrow('Item is not currently writable');
		expect(db.prepare('SELECT status FROM inbox_documents WHERE id = ?').get('document-1')).toEqual(
			{
				status: 'ROUTING'
			}
		);
		expect(db.prepare('SELECT COUNT(*) AS n FROM attachments').get()).toEqual({ n: 0 });
	});
});
