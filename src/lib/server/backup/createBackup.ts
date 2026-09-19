import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import packageJson from '../../../../package.json';
import {
	BACKUP_FORMAT_VERSION,
	type BackupManifest,
	type ManifestEntry
} from '$lib/domain/backup/manifest';
import { config } from '../config';
import { getDb } from '../db/database';
import { listAppliedMigrations } from '../db/migrate';
import { assertEnoughFreeSpace, DISK_SPACE_SAFETY_FACTOR } from './diskSpace';
import { resolveStoragePath } from '../files/attachmentStorage';
import { resolveInboxStoragePath } from '../files/inboxStorage';
import { scanPlaybookDirectory } from '../playbooks/loader';
import { MAX_ARCHIVE_BYTES, MAX_ENTRIES, MAX_TOTAL_BYTES, writeArchive } from './archive';

export class AttachmentBackupError extends Error {
	constructor(
		public readonly attachmentId: string,
		reason: string
	) {
		super(reason);
	}
}

/**
 * Life Admin must never create a backup the current archive reader could
 * not restore. Both sides share the exact same limits (imported from
 * ./archive, the reader's own module) rather than a second, possibly
 * drifting copy of the numbers.
 */
export class BackupTooLargeError extends Error {}

function sha256(body: Uint8Array): string {
	return createHash('sha256').update(body).digest('hex');
}

function utcStamp(date: Date): string {
	return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/**
 * The timestamp alone is only second-precision, so two backups requested
 * within the same second (two concurrent downloads, or two concurrent
 * restores each writing a pre-restore safety backup) would otherwise
 * compute the identical filename and collide on disk — the second write
 * would overwrite the first's file, which for a retained safety backup is
 * silent data loss, and for an in-flight download could corrupt or delete
 * the file the first request is still streaming. The random suffix makes
 * every generated filename unique regardless of timing, while keeping the
 * timestamp first so lexicographic sort (pruneSafetyBackups' "newest
 * three") is unaffected.
 */
function uniqueSuffix(): string {
	return randomBytes(3).toString('hex');
}

export function sanitizeSnapshot(snapshotPath: string): void {
	const snapshot = new Database(snapshotPath);
	try {
		snapshot.exec(
			"DELETE FROM sessions; UPDATE users SET failed_login_count = 0, locked_until = NULL; DELETE FROM app_settings WHERE key LIKE 'secret.%';"
		);
	} finally {
		snapshot.close();
	}
}

export interface WriteLimits {
	maxEntries: number;
	maxTotalBytes: number;
	maxArchiveBytes: number;
}

const DEFAULT_WRITE_LIMITS: WriteLimits = {
	maxEntries: MAX_ENTRIES,
	maxTotalBytes: MAX_TOTAL_BYTES,
	maxArchiveBytes: MAX_ARCHIVE_BYTES
};

export function createBackup(
	input: {
		intoDir?: string;
		filenamePrefix?: string;
		/** Overridable only for tests, so the exact same restore-side caps
		 *  (imported above) can be exercised without allocating hundreds of
		 *  real megabytes. Production code never passes this. */
		limits?: WriteLimits;
	} = {}
): {
	filePath: string;
	filename: string;
} {
	const limits = input.limits ?? DEFAULT_WRITE_LIMITS;
	const destinationDir = input.intoDir ?? config.dataDir;
	fs.mkdirSync(destinationDir, { recursive: true });
	const currentDatabaseBytes = fs.existsSync(config.databasePath)
		? fs.statSync(config.databasePath).size
		: 0;
	// Cheap upfront estimate for the free-space check, taken before anything
	// is read into memory: the live database file size, plus attachment
	// bytes queried from the database (not yet read off disk), plus custom
	// playbook file sizes. Real enforcement of the hard size caps happens
	// below, against the actual planned archive contents.
	const attachmentByteEstimate = (
		getDb()
			.prepare(
				'SELECT COALESCE(SUM(byte_size), 0) AS total FROM attachments UNION ALL SELECT COALESCE(SUM(byte_size), 0) FROM inbox_documents'
			)
			.all() as {
			total: number;
		}[]
	).reduce((sum, row) => sum + row.total, 0);
	const { loaded: playbookFiles } = scanPlaybookDirectory(config.customPlaybooksDir);
	const playbookByteEstimate = playbookFiles.reduce(
		(sum, file) => sum + fs.statSync(file.filePath).size,
		0
	);
	// A backup needs room for the VACUUM INTO snapshot, the sanitized copy and
	// the final archive at once, roughly 2-3x the total planned content size.
	assertEnoughFreeSpace(
		config.dataDir,
		(currentDatabaseBytes + attachmentByteEstimate + playbookByteEstimate) *
			DISK_SPACE_SAFETY_FACTOR
	);
	const staging = fs.mkdtempSync(path.join(config.dataDir, '.backup-'));
	const filename = `${input.filenamePrefix ?? 'lifeadmin-backup'}-${utcStamp(new Date())}-${uniqueSuffix()}.zip`;
	const filePath = path.join(destinationDir, filename);
	try {
		const snapshotPath = path.join(staging, 'lifeadmin.sqlite');
		getDb().prepare('VACUUM INTO ?').run(snapshotPath);
		sanitizeSnapshot(snapshotPath);
		const archiveEntries: { name: string; body: Uint8Array }[] = [];
		const contents: ManifestEntry[] = [];
		const add = (
			kind: 'sqlite' | 'playbook' | 'attachment' | 'inbox',
			name: string,
			body: Uint8Array
		) => {
			contents.push({ kind, path: name, bytes: body.byteLength, sha256: sha256(body) });
			archiveEntries.push({ name, body });
		};
		add('sqlite', 'db/lifeadmin.sqlite', fs.readFileSync(snapshotPath));

		// Reuses the scan taken above (for the disk-space estimate) rather than
		// scanning again: the same recursive scan the runtime playbook loader
		// uses (size cap, file-count cap, depth cap, symlinks always
		// rejected), so a nested custom playbook a request would actually
		// load is never silently missing from the backup, nothing the loader
		// would reject is ever included, and the file list cannot drift
		// between the estimate and the actual archive contents.
		for (const file of playbookFiles) {
			const relative = path
				.relative(config.customPlaybooksDir, file.filePath)
				.split(path.sep)
				.join('/');
			add('playbook', `playbooks/${relative}`, fs.readFileSync(file.filePath));
		}

		const snapshot = new Database(snapshotPath, { readonly: true });
		try {
			const rows = snapshot
				.prepare('SELECT id, storage_key, byte_size, sha256 FROM attachments')
				.all() as { id: string; storage_key: string; byte_size: number; sha256: string }[];
			for (const row of rows) {
				// storage_key comes from the database, not from a validated
				// upload: a hand-edited or restored-from-tampered-archive row
				// could name a path outside the attachments root. Read it only
				// through the same containment check the download endpoint
				// uses, never by joining it onto the root directly, so a
				// malicious row fails the backup instead of exfiltrating an
				// arbitrary file.
				let source: string;
				try {
					source = resolveStoragePath(row.storage_key);
				} catch {
					throw new AttachmentBackupError(row.id, 'invalid storage key');
				}
				let body: Buffer;
				try {
					body = fs.readFileSync(source);
				} catch {
					throw new AttachmentBackupError(row.id, 'file missing');
				}
				if (body.byteLength !== row.byte_size || sha256(body) !== row.sha256)
					throw new AttachmentBackupError(row.id, 'file does not match its recorded checksum');
				add('attachment', `attachments/${row.storage_key}`, body);
			}
			const inboxRows = snapshot
				.prepare('SELECT id, storage_key, byte_size, sha256 FROM inbox_documents')
				.all() as { id: string; storage_key: string; byte_size: number; sha256: string }[];
			for (const row of inboxRows) {
				let source: string;
				try {
					source = resolveInboxStoragePath(row.storage_key);
				} catch {
					throw new AttachmentBackupError(row.id, 'invalid inbox storage key');
				}
				let body: Buffer;
				try {
					body = fs.readFileSync(source);
				} catch {
					throw new AttachmentBackupError(row.id, 'inbox file missing');
				}
				if (body.byteLength !== row.byte_size || sha256(body) !== row.sha256)
					throw new AttachmentBackupError(
						row.id,
						'inbox file does not match its recorded checksum'
					);
				add('inbox', `inbox/${row.storage_key}`, body);
			}
		} finally {
			snapshot.close();
		}
		// Fail before ever writing an archive the reader could not restore:
		// the exact same maxEntries/maxTotalBytes the reader enforces (see
		// DEFAULT_WRITE_LIMITS above), checked here against the actual
		// planned contents (the manifest entry plus one per
		// sqlite/playbook/attachment entry).
		if (contents.length + 1 > limits.maxEntries) throw new BackupTooLargeError('TOO_MANY_ENTRIES');
		const plannedTotalBytes = archiveEntries.reduce((sum, entry) => sum + entry.body.byteLength, 0);
		if (plannedTotalBytes > limits.maxTotalBytes)
			throw new BackupTooLargeError('PLANNED_SIZE_TOO_LARGE');

		const manifest: BackupManifest = {
			backupFormatVersion: BACKUP_FORMAT_VERSION,
			createdAt: new Date().toISOString(),
			app: { name: packageJson.name, version: packageJson.version },
			schema: { migrationsApplied: listAppliedMigrations(getDb()) },
			contents
		};
		const body = writeArchive([
			{ name: 'manifest.json', body: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
			...archiveEntries
		]);
		// The archive is built entirely in memory (fflate's zipSync), so the
		// compressed-size cap is checked before anything is ever written to
		// disk: an oversized backup is refused, not written-then-deleted.
		if (body.byteLength > limits.maxArchiveBytes)
			throw new BackupTooLargeError('COMPRESSED_ARCHIVE_TOO_LARGE');
		fs.writeFileSync(filePath, body);
		return { filePath, filename };
	} finally {
		fs.rmSync(staging, { recursive: true, force: true });
	}
}
