import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { checkCompatibility, type BackupManifest } from '$lib/domain/backup/manifest';
import { config } from '../config';
import { closeDb, getDb } from '../db/database';
import { listKnownMigrations } from '../db/migrate';
import { log } from '../log';
import { latchRestorePending } from '../restoreState';
import { extractArchive, resolveEntryDestination } from './archive';
import { createBackup } from './createBackup';
import { assertEnoughFreeSpace, DISK_SPACE_SAFETY_FACTOR } from './diskSpace';
import {
	reconcileStagedAttachments,
	type AttachmentReconciliationReport
} from './attachmentReconciliation';
import { assertStagedInboxConsistency } from './inboxReconciliation';

const SAFETY_BACKUP_PREFIX = 'pre-restore';
const SAFETY_BACKUPS_TO_KEEP = 3;
const RELATIONS_MIGRATION = '0015_item_relations';

function hasActiveCanonicalPairConstraint(definition: string): boolean {
	const sql = definition
		.replace(/--[^\n]*/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/'(?:''|[^'])*'/g, "''")
		.replace(/"(?:""|[^"])*"/g, '""');
	return /\bcheck\s*\(\s*item_a_id\s*<\s*item_b_id\s*\)/i.test(sql);
}

export interface StagedRestore {
	directory: string;
	manifest: BackupManifest;
	attachmentReconciliation: AttachmentReconciliationReport;
}

export function assertRestoreDatabaseValid(db: Database.Database): void {
	if ((db.pragma('integrity_check', { simple: true }) as string) !== 'ok')
		throw new Error('DATABASE_DAMAGED');
	const foreignKeyFailures = db.pragma('foreign_key_check') as unknown[];
	if (foreignKeyFailures.length > 0) throw new Error('DATABASE_FOREIGN_KEY_VIOLATION');
	const relationsTable = db
		.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'item_relations'")
		.get();
	const migrationsTable = db
		.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
		.get();
	const relationsMigrationApplied = Boolean(
		migrationsTable &&
		db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(RELATIONS_MIGRATION)
	);
	if (relationsMigrationApplied !== Boolean(relationsTable)) {
		throw new Error('DATABASE_INVALID_RELATION_SCHEMA');
	}
	if (relationsTable) {
		const columns = db.pragma('table_info(item_relations)') as {
			name: string;
			type: string;
			notnull: number;
			pk: number;
		}[];
		const column = (name: string) => columns.find((entry) => entry.name === name);
		const foreignKeys = db.pragma('foreign_key_list(item_relations)') as {
			from: string;
			table: string;
			to: string;
			on_update: string;
			on_delete: string;
		}[];
		const indexes = db.pragma('index_list(item_relations)') as {
			name: string;
			unique: number;
			origin: string;
		}[];
		const definition = db
			.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'item_relations'")
			.get() as { sql: string };
		const expectedForeignKey = (from: string) =>
			foreignKeys.some(
				(key) =>
					key.from === from &&
					key.table === 'items' &&
					key.to === 'id' &&
					key.on_update === 'NO ACTION' &&
					key.on_delete === 'RESTRICT'
			);
		const expectedIndex = (name: string, columnName: string) => {
			const index = indexes.find((entry) => entry.name === name);
			if (!index || index.unique !== 0 || index.origin !== 'c') return false;
			const indexedColumns = db.pragma(`index_info(${name})`) as { name: string }[];
			return indexedColumns.length === 1 && indexedColumns[0]?.name === columnName;
		};
		if (
			columns.length !== 3 ||
			column('item_a_id')?.type.toUpperCase() !== 'TEXT' ||
			column('item_a_id')?.notnull !== 1 ||
			column('item_a_id')?.pk !== 1 ||
			column('item_b_id')?.type.toUpperCase() !== 'TEXT' ||
			column('item_b_id')?.notnull !== 1 ||
			column('item_b_id')?.pk !== 2 ||
			column('created_at')?.type.toUpperCase() !== 'TEXT' ||
			column('created_at')?.notnull !== 1 ||
			column('created_at')?.pk !== 0 ||
			foreignKeys.length !== 2 ||
			!expectedForeignKey('item_a_id') ||
			!expectedForeignKey('item_b_id') ||
			!expectedIndex('ix_item_relations_item_a', 'item_a_id') ||
			!expectedIndex('ix_item_relations_item_b', 'item_b_id') ||
			!hasActiveCanonicalPairConstraint(definition.sql)
		) {
			throw new Error('DATABASE_INVALID_RELATION_SCHEMA');
		}
		const missingEndpoint = db
			.prepare(
				`SELECT 1
				 FROM item_relations r
				 LEFT JOIN items item_a ON item_a.id = r.item_a_id
				 LEFT JOIN items item_b ON item_b.id = r.item_b_id
				 WHERE item_a.id IS NULL OR item_b.id IS NULL
				 LIMIT 1`
			)
			.get();
		if (missingEndpoint) throw new Error('DATABASE_INVALID_RELATIONS');
		const rows = db
			.prepare('SELECT item_a_id AS itemAId, item_b_id AS itemBId FROM item_relations')
			.all() as { itemAId: string; itemBId: string }[];
		const pairs = new Set<string>();
		for (const row of rows) {
			if (row.itemAId >= row.itemBId) throw new Error('DATABASE_INVALID_RELATIONS');
			const pair = `${row.itemAId}\u0000${row.itemBId}`;
			if (pairs.has(pair)) throw new Error('DATABASE_INVALID_RELATIONS');
			pairs.add(pair);
		}
	}
}

export async function stageRestore(uploadPath: string): Promise<StagedRestore> {
	fs.mkdirSync(config.restoreStagingDir, { recursive: true });
	// The extracted contents can be several times larger than the compressed
	// upload; the archive's own size on disk is the only bound known before
	// extraction starts, so it is used as the (deliberately generous) basis
	// for the free-space check.
	assertEnoughFreeSpace(config.dataDir, fs.statSync(uploadPath).size * DISK_SPACE_SAFETY_FACTOR);
	const directory = fs.mkdtempSync(path.join(config.restoreStagingDir, 'staged-'));
	try {
		const manifest = await extractArchive(uploadPath, directory);
		// A restore represents the full state of the backup, not a merge:
		// these directories must exist (possibly empty) so commitRestore's
		// swap always replaces the live directory, even with emptiness,
		// rather than skipping the swap because nothing was extracted (an
		// archive with zero playbook or attachment entries, including every
		// pre-Slice-7 backup, is exactly that case).
		fs.mkdirSync(path.join(directory, 'playbooks'), { recursive: true });
		fs.mkdirSync(path.join(directory, 'attachments'), { recursive: true });
		fs.mkdirSync(path.join(directory, 'inbox'), { recursive: true });
		if (
			checkCompatibility(manifest.schema.migrationsApplied, listKnownMigrations()).kind ===
			'TOO_NEW'
		)
			throw new Error('BACKUP_TOO_NEW');
		for (const entry of manifest.contents) {
			const filePath = resolveEntryDestination(directory, entry);
			const bytes = fs.readFileSync(filePath);
			if (
				bytes.byteLength !== entry.bytes ||
				createHash('sha256').update(bytes).digest('hex') !== entry.sha256
			)
				throw new Error('CHECKSUM_MISMATCH');
		}
		const db = new Database(path.join(directory, 'lifeadmin.sqlite'), { readonly: true });
		try {
			assertRestoreDatabaseValid(db);
		} finally {
			db.close();
		}
		const attachmentReconciliation = reconcileStagedAttachments(directory);
		assertStagedInboxConsistency(directory);
		return { directory, manifest, attachmentReconciliation };
	} catch (cause) {
		fs.rmSync(directory, { recursive: true, force: true });
		throw cause;
	}
}

export function discardStaging(staged: StagedRestore): void {
	fs.rmSync(staged.directory, { recursive: true, force: true });
}

/**
 * Deletes every safety backup beyond the newest `SAFETY_BACKUPS_TO_KEEP`, so a
 * long-lived install that gets restored repeatedly cannot fill an SD card.
 * Best effort: a failure here must never fail the restore itself.
 */
export function pruneSafetyBackups(dir: string): void {
	try {
		const files = fs
			.readdirSync(dir)
			.filter((name) => name.startsWith(`${SAFETY_BACKUP_PREFIX}-`) && name.endsWith('.zip'))
			.sort();
		for (const name of files.slice(0, Math.max(0, files.length - SAFETY_BACKUPS_TO_KEEP))) {
			fs.rmSync(path.join(dir, name), { force: true });
		}
	} catch (cause) {
		log.warn('failed to prune old safety backups', {
			reason: cause instanceof Error ? cause.message : 'unknown'
		});
	}
}

interface CompletedSwap {
	target: string;
	/** The path the original content of `target` was moved aside to, or null
	 *  if `target` did not exist before this swap. */
	replaced: string | null;
}

/**
 * Moves `stagedSource` into `target`, first moving any existing content at
 * `target` aside so a later failure can restore it exactly. Records what it
 * did in `completed` so the caller can undo every swap, in reverse order, the
 * moment any one of them fails. Skipped entirely when `stagedSource` does not
 * exist (e.g. a restore whose archive had no custom playbooks).
 */
function swapIntoPlace(
	target: string,
	stagedSource: string,
	stamp: number,
	completed: CompletedSwap[]
): void {
	if (!fs.existsSync(stagedSource)) return;
	let replaced: string | null = null;
	if (fs.existsSync(target)) {
		replaced = `${target}.replaced-${stamp}`;
		fs.renameSync(target, replaced);
	}
	try {
		fs.renameSync(stagedSource, target);
	} catch (cause) {
		if (replaced) fs.renameSync(replaced, target);
		throw cause;
	}
	completed.push({ target, replaced });
}

/** Undoes every completed swap, most recent first. Best effort per step: one
 *  failed undo must not stop the others from running. */
function rollbackSwaps(completed: readonly CompletedSwap[]): void {
	for (const step of [...completed].reverse()) {
		try {
			fs.rmSync(step.target, { recursive: true, force: true });
			if (step.replaced) fs.renameSync(step.replaced, step.target);
		} catch (cause) {
			log.error(
				'restore rollback step failed; manual recovery from the safety backup is required',
				{
					target: step.target,
					reason: cause instanceof Error ? cause.message : 'unknown'
				}
			);
		}
	}
}

/**
 * Swaps the staged database, custom playbooks and attachments into place.
 *
 * RESTORE_PENDING is latched BEFORE the first rename and is never cleared by
 * this function, on success or on failure: `getDb()` throws for the rest of
 * this process's lifetime either way, because process state (this
 * connection's cache, in-memory singletons) is no longer trustworthy once a
 * swap has been attempted. Recovery is always "the operator restarts the
 * container", per the roadmap's explicit correction that Docker does not
 * restart a container on an unhealthy HEALTHCHECK.
 *
 * If a swap fails partway through (e.g. the attachments rename fails after
 * the database and playbooks were already swapped), every completed swap is
 * rolled back in reverse order so the working tree is not left in a mixed
 * state, even though the app itself will not serve requests again until the
 * operator restarts it.
 */
export function commitRestore(staged: StagedRestore): { safetyBackup: string } {
	fs.mkdirSync(config.backupsDir, { recursive: true });
	const safety = createBackup({ intoDir: config.backupsDir, filenamePrefix: SAFETY_BACKUP_PREFIX });
	pruneSafetyBackups(config.backupsDir);

	// Checkpoint the WAL into the main file BEFORE latching RESTORE_PENDING:
	// getDb() itself throws once the latch is set, so this must run on the
	// still-open connection. Without it, the file we are about to move aside
	// could be missing transactions that were only ever in the WAL.
	try {
		getDb().pragma('wal_checkpoint(TRUNCATE)');
	} catch (cause) {
		log.warn('wal checkpoint before restore failed; proceeding with close anyway', {
			reason: cause instanceof Error ? cause.message : 'unknown'
		});
	}

	latchRestorePending({ safetyBackup: safety.filename });
	closeDb();
	fs.rmSync(`${config.databasePath}-wal`, { force: true });
	fs.rmSync(`${config.databasePath}-shm`, { force: true });

	const stamp = Date.now();
	const completed: CompletedSwap[] = [];
	try {
		swapIntoPlace(
			config.databasePath,
			path.join(staged.directory, 'lifeadmin.sqlite'),
			stamp,
			completed
		);
		swapIntoPlace(
			config.customPlaybooksDir,
			path.join(staged.directory, 'playbooks'),
			stamp,
			completed
		);
		swapIntoPlace(
			config.attachmentsDir,
			path.join(staged.directory, 'attachments'),
			stamp,
			completed
		);
		swapIntoPlace(config.inboxDir, path.join(staged.directory, 'inbox'), stamp, completed);
		return { safetyBackup: safety.filename };
	} catch (cause) {
		rollbackSwaps(completed);
		throw cause;
	} finally {
		discardStaging(staged);
	}
}
