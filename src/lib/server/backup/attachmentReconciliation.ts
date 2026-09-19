import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isValidStorageKey } from '$lib/domain/attachment/attachment';
import { resolveWithinAttachmentsRoot } from '../files/attachmentPath';

export interface AttachmentReconciliationReport {
	/** Attachment ids whose row has no corresponding file. */
	missingFiles: string[];
	/** Attachment ids whose file exists but does not match the row's
	 *  recorded byte length or sha256. */
	mismatchedFiles: string[];
	/** Storage keys of files under attachments/ with no attachments row
	 *  referencing them. */
	orphanedFiles: string[];
	/** Attachment ids whose storage_key failed the same format/containment
	 *  check the live storage adapter uses. The row is untrusted input
	 *  (restored from an archive, possibly hand-edited), so its storage_key
	 *  is never joined onto a path directly. */
	invalidStorageKeys: string[];
}

/** Thrown when the staged database has no `attachments` table at all (a
 *  valid pre-Slice-7 backup) but the staged attachments directory contains
 *  files anyway — a state no real backup this app ever produced can be in,
 *  so it is rejected outright rather than silently restoring unreferenced
 *  files. */
export class AttachmentsWithoutTableError extends Error {}

function hasAttachmentsTable(db: InstanceType<typeof Database>): boolean {
	return (
		db
			.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'attachments'`)
			.get() !== undefined
	);
}

function anyFileUnder(root: string): boolean {
	if (!fs.existsSync(root)) return false;
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const full = path.join(root, entry.name);
		if (entry.isDirectory()) {
			if (anyFileUnder(full)) return true;
		} else {
			return true;
		}
	}
	return false;
}

/**
 * Compares the staged database's `attachments` rows against the staged
 * `attachments/` files. Never fails the restore for a row/file mismatch: an
 * archive we did not write ourselves (hand-edited, or built by a future or
 * third-party tool) is not something restore can fix, so inconsistencies
 * are reported for the operator to see in the logs, not treated as a
 * reason to refuse data the checksum and integrity checks already accepted.
 * This is the asymmetric counterpart to createBackup's AttachmentBackupError,
 * which fails a *backup* on the same kind of inconsistency because that one
 * we do control.
 *
 * The one case this DOES throw for: a staged database with no `attachments`
 * table (a valid older backup, predating Slice 7) whose staging directory
 * nonetheless contains files. That combination cannot come from a real
 * backup this app produced, so it is treated as a structural inconsistency
 * (AttachmentsWithoutTableError), not a reportable one.
 */
export function reconcileStagedAttachments(stagedDir: string): AttachmentReconciliationReport {
	const report: AttachmentReconciliationReport = {
		missingFiles: [],
		mismatchedFiles: [],
		orphanedFiles: [],
		invalidStorageKeys: []
	};
	const dbPath = path.join(stagedDir, 'lifeadmin.sqlite');
	const attachmentsRoot = path.join(stagedDir, 'attachments');
	if (!fs.existsSync(dbPath)) return report;

	const db = new Database(dbPath, { readonly: true });
	try {
		if (!hasAttachmentsTable(db)) {
			// A valid pre-Slice-7 backup: no table means no attachments were
			// ever possible, so the expected set is empty. A staged file
			// existing anyway is inconsistent with that and must not be
			// silently restored as an unreferenced file.
			if (anyFileUnder(attachmentsRoot)) {
				throw new AttachmentsWithoutTableError('ATTACHMENTS_WITHOUT_TABLE');
			}
			return report;
		}

		const referencedKeys = new Set<string>();
		const rows = db.prepare('SELECT id, storage_key, byte_size, sha256 FROM attachments').all() as {
			id: string;
			storage_key: string;
			byte_size: number;
			sha256: string;
		}[];
		for (const row of rows) {
			// storage_key is read back from a restored (untrusted) database, the
			// same way a live attachments row is untrusted at backup time: never
			// join it onto a path directly. A malformed or traversal-shaped key
			// is reported, never resolved against the filesystem.
			if (!isValidStorageKey(row.storage_key)) {
				report.invalidStorageKeys.push(row.id);
				continue;
			}
			referencedKeys.add(row.storage_key);
			const filePath = resolveWithinAttachmentsRoot(attachmentsRoot, row.storage_key);
			let bytes: Buffer;
			try {
				bytes = fs.readFileSync(filePath);
			} catch {
				report.missingFiles.push(row.id);
				continue;
			}
			if (
				bytes.byteLength !== row.byte_size ||
				createHash('sha256').update(bytes).digest('hex') !== row.sha256
			) {
				report.mismatchedFiles.push(row.id);
			}
		}

		const walk = (dir: string): void => {
			if (!fs.existsSync(dir)) return;
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full);
					continue;
				}
				const key = path.relative(attachmentsRoot, full).split(path.sep).join('/');
				if (!referencedKeys.has(key)) report.orphanedFiles.push(key);
			}
		};
		walk(attachmentsRoot);
	} finally {
		db.close();
	}

	return report;
}
