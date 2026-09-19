import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isValidStorageKey } from '$lib/domain/attachment/attachment';
import { resolveWithinAttachmentsRoot } from '../files/attachmentPath';

/** A staged Inbox must be complete before it can replace the live Inbox.
 * Unlike Attachment reports, Inbox rows are pending user work, so accepting a
 * broken row would silently hide data the user can no longer route. */
export class InboxRestoreConsistencyError extends Error {}

function filesUnder(root: string): string[] {
	if (!fs.existsSync(root)) return [];
	return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(root, entry.name);
		return entry.isDirectory()
			? filesUnder(full).map((file) => path.join(entry.name, file))
			: [entry.name];
	});
}

export function assertStagedInboxConsistency(stagedDir: string): void {
	const dbPath = path.join(stagedDir, 'lifeadmin.sqlite');
	const root = path.join(stagedDir, 'inbox');
	if (!fs.existsSync(dbPath)) return;
	const db = new Database(dbPath, { readonly: true });
	try {
		const hasTable = db
			.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'inbox_documents'`)
			.get();
		if (!hasTable) {
			if (filesUnder(root).length) throw new InboxRestoreConsistencyError('INBOX_WITHOUT_TABLE');
			return;
		}
		const referenced = new Set<string>();
		const rows = db
			.prepare('SELECT id, storage_key, byte_size, sha256 FROM inbox_documents')
			.all() as { id: string; storage_key: string; byte_size: number; sha256: string }[];
		for (const row of rows) {
			if (!isValidStorageKey(row.storage_key))
				throw new InboxRestoreConsistencyError(`INVALID_INBOX_KEY:${row.id}`);
			referenced.add(row.storage_key);
			let bytes: Buffer;
			try {
				bytes = fs.readFileSync(resolveWithinAttachmentsRoot(root, row.storage_key));
			} catch {
				throw new InboxRestoreConsistencyError(`MISSING_INBOX_FILE:${row.id}`);
			}
			if (
				bytes.byteLength !== row.byte_size ||
				createHash('sha256').update(bytes).digest('hex') !== row.sha256
			)
				throw new InboxRestoreConsistencyError(`MISMATCHED_INBOX_FILE:${row.id}`);
		}
		for (const file of filesUnder(root)) {
			const key = file.split(path.sep).join('/');
			if (!referenced.has(key))
				throw new InboxRestoreConsistencyError(`ORPHANED_INBOX_FILE:${key}`);
		}
	} finally {
		db.close();
	}
}
