import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupManifest } from '$lib/domain/backup/manifest';

let tmpDir: string;
let config: (typeof import('../config'))['config'];
let getDb: (typeof import('../db/database'))['getDb'];
let closeDb: (typeof import('../db/database'))['closeDb'];
let openDatabase: (typeof import('../db/database'))['openDatabase'];
let DatabaseClosedForRestoreError: (typeof import('../db/database'))['DatabaseClosedForRestoreError'];
let commitRestore: (typeof import('./restore'))['commitRestore'];
let stageRestore: (typeof import('./restore'))['stageRestore'];
let pruneSafetyBackups: (typeof import('./restore'))['pruneSafetyBackups'];
let assertRestoreDatabaseValid: (typeof import('./restore'))['assertRestoreDatabaseValid'];
let createBackup: (typeof import('./createBackup'))['createBackup'];
let writeArchive: (typeof import('./archive'))['writeArchive'];
let listKnownMigrations: (typeof import('../db/migrate'))['listKnownMigrations'];
let listAppliedMigrations: (typeof import('../db/migrate'))['listAppliedMigrations'];
let log: (typeof import('../log'))['log'];
let isRestorePending: (typeof import('../restoreState'))['isRestorePending'];
let getRestorePending: (typeof import('../restoreState'))['getRestorePending'];
let itemsPort: (typeof import('../appPorts'))['itemsPort'];
let cyclesPort: (typeof import('../appPorts'))['cyclesPort'];
let attachmentsPort: (typeof import('../appPorts'))['attachmentsPort'];
let attachmentStoragePort: (typeof import('../appPorts'))['attachmentStoragePort'];
let idsPort: (typeof import('../appPorts'))['idsPort'];
let appClock: (typeof import('../appPorts'))['clock'];
let addAttachment: (typeof import('$lib/application/attachments/attachments'))['addAttachment'];
let removeAttachment: (typeof import('$lib/application/attachments/attachments'))['removeAttachment'];
let fieldsPort: (typeof import('../appPorts'))['fieldsPort'];

const dummyManifest: BackupManifest = {
	backupFormatVersion: 1,
	createdAt: '2026-01-01T00:00:00.000Z',
	app: { name: 'life-admin', version: '0.0.0' },
	schema: { migrationsApplied: [] },
	contents: []
};

/** commitRestore itself never reads attachmentReconciliation (only the
 *  route does, after stageRestore produces it for real), so tests that
 *  build a StagedRestore by hand can use an empty placeholder. */
function stagedAt(directory: string): import('./restore').StagedRestore {
	return {
		directory,
		manifest: dummyManifest,
		attachmentReconciliation: {
			missingFiles: [],
			mismatchedFiles: [],
			orphanedFiles: [],
			invalidStorageKeys: []
		}
	};
}

beforeEach(async () => {
	vi.resetModules();
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-restore-'));
	vi.stubEnv('LIFEADMIN_DATA_DIR', tmpDir);
	({ config } = await import('../config'));
	({ getDb, closeDb, openDatabase, DatabaseClosedForRestoreError } =
		await import('../db/database'));
	({ commitRestore, stageRestore, pruneSafetyBackups, assertRestoreDatabaseValid } =
		await import('./restore'));
	({ createBackup } = await import('./createBackup'));
	({ writeArchive } = await import('./archive'));
	({ listKnownMigrations, listAppliedMigrations } = await import('../db/migrate'));
	({ isRestorePending, getRestorePending } = await import('../restoreState'));
	({ log } = await import('../log'));
	({
		itemsPort,
		cyclesPort,
		fieldsPort,
		attachmentsPort,
		attachmentStoragePort,
		idsPort,
		clock: appClock
	} = await import('../appPorts'));
	({ addAttachment, removeAttachment } = await import('$lib/application/attachments/attachments'));

	// Original ("current") state: a real db row, a custom playbook, an attachment.
	getDb()
		.prepare(
			`INSERT INTO items (id, title, created_at, updated_at) VALUES ('item-A', 'Original', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
		)
		.run();
	fs.mkdirSync(config.customPlaybooksDir, { recursive: true });
	fs.writeFileSync(path.join(config.customPlaybooksDir, 'a.yaml'), 'ORIGINAL_PLAYBOOK');
	fs.mkdirSync(path.join(config.attachmentsDir, 'ab'), { recursive: true });
	fs.writeFileSync(path.join(config.attachmentsDir, 'ab', 'original-file'), 'ORIGINAL_ATTACHMENT');
});

afterEach(() => {
	vi.restoreAllMocks();
	try {
		closeDb();
	} catch {
		// getDb()/closeDb() are expected to be unusable after some tests.
	}
	vi.unstubAllEnvs();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** Builds a real, readable ZIP archive at a temp path from a manifest and its
 *  declared entries, for tests that need to feed a crafted archive into
 *  stageRestore rather than constructing StagedRestore output directly. */
function writeCraftedArchive(manifest: BackupManifest, dbBytes: Uint8Array): string {
	const archivePath = fs.mkdtempSync(path.join(tmpDir, 'crafted-')) + '.zip';
	const body = writeArchive([
		{ name: 'manifest.json', body: new TextEncoder().encode(JSON.stringify(manifest)) },
		{ name: 'db/lifeadmin.sqlite', body: dbBytes }
	]);
	fs.writeFileSync(archivePath, body);
	return archivePath;
}

function buildStagedDirectory(): string {
	const staged = fs.mkdtempSync(path.join(tmpDir, 'staged-'));
	fs.writeFileSync(path.join(staged, 'lifeadmin.sqlite'), 'NEW_DB_BYTES');
	fs.mkdirSync(path.join(staged, 'playbooks'), { recursive: true });
	fs.writeFileSync(path.join(staged, 'playbooks', 'b.yaml'), 'NEW_PLAYBOOK');
	fs.mkdirSync(path.join(staged, 'attachments', 'cd'), { recursive: true });
	fs.writeFileSync(path.join(staged, 'attachments', 'cd', 'new-file'), 'NEW_ATTACHMENT');
	return staged;
}

describe('commitRestore / happy path', () => {
	it('swaps database, playbooks and attachments into place, replacing playbooks wholesale', () => {
		const staged = buildStagedDirectory();
		commitRestore(stagedAt(staged));

		expect(fs.readFileSync(config.databasePath, 'utf8')).toBe('NEW_DB_BYTES');
		expect(fs.readFileSync(path.join(config.customPlaybooksDir, 'b.yaml'), 'utf8')).toBe(
			'NEW_PLAYBOOK'
		);
		// Wholesale replacement: the playbook that existed before the restore
		// is gone from the live directory, not merged with the new one.
		expect(fs.existsSync(path.join(config.customPlaybooksDir, 'a.yaml'))).toBe(false);
		expect(fs.readFileSync(path.join(config.attachmentsDir, 'cd', 'new-file'), 'utf8')).toBe(
			'NEW_ATTACHMENT'
		);
		expect(isRestorePending()).toBe(true);

		// The previous database is renamed aside, not deleted, even on success.
		const leftovers = fs.readdirSync(config.dataDir).filter((name) => name.includes('.replaced-'));
		expect(leftovers.length).toBeGreaterThan(0);
		expect(fs.existsSync(`${config.databasePath}-wal`)).toBe(false);
		expect(fs.existsSync(`${config.databasePath}-shm`)).toBe(false);
	});

	it('names the safety backup pre-restore-<UTC>.zip', () => {
		const staged = buildStagedDirectory();
		commitRestore(stagedAt(staged));
		const backups = fs.readdirSync(config.backupsDir).filter((name) => name.endsWith('.zip'));
		expect(backups).toHaveLength(1);
		expect(backups[0]).toMatch(/^pre-restore-\d{8}-\d{6}-[0-9a-f]{6}\.zip$/);
	});

	it('checkpoints the WAL on the still-open connection before RESTORE_PENDING is latched', () => {
		// Regression: the checkpoint must run BEFORE latchRestorePending(),
		// because getDb() itself throws once the latch is set. If the ordering
		// regresses, this warning is logged on every restore and the
		// checkpoint silently never runs.
		const warnSpy = vi.spyOn(log, 'warn');
		commitRestore(stagedAt(buildStagedDirectory()));
		expect(warnSpy).not.toHaveBeenCalledWith(
			expect.stringContaining('wal checkpoint'),
			expect.anything()
		);
	});
});

describe('pruneSafetyBackups', () => {
	it('keeps only the newest three pre-restore archives, other files untouched', () => {
		fs.mkdirSync(config.backupsDir, { recursive: true });
		const names = [
			'pre-restore-20260101-000000.zip',
			'pre-restore-20260102-000000.zip',
			'pre-restore-20260103-000000.zip',
			'pre-restore-20260104-000000.zip',
			'pre-restore-20260105-000000.zip',
			'lifeadmin-backup-20260101-000000.zip'
		];
		for (const name of names) fs.writeFileSync(path.join(config.backupsDir, name), 'x');

		pruneSafetyBackups(config.backupsDir);

		const remaining = fs.readdirSync(config.backupsDir).sort();
		expect(remaining).toEqual([
			'lifeadmin-backup-20260101-000000.zip',
			'pre-restore-20260103-000000.zip',
			'pre-restore-20260104-000000.zip',
			'pre-restore-20260105-000000.zip'
		]);
	});
});

describe('commitRestore / compensating rollback', () => {
	it('rolls back an already-completed database and playbook swap when the attachments swap fails, and stays RESTORE_PENDING with getDb() locked', () => {
		const staged = buildStagedDirectory();
		const realRenameSync = fs.renameSync.bind(fs);
		let sabotaged = false;
		vi.spyOn(fs, 'renameSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
			if (!sabotaged && String(to) === config.attachmentsDir) {
				sabotaged = true;
				throw new Error('SIMULATED_RENAME_FAILURE');
			}
			return realRenameSync(from, to);
		}) as typeof fs.renameSync);

		expect(() => commitRestore(stagedAt(staged))).toThrow('SIMULATED_RENAME_FAILURE');

		vi.restoreAllMocks();

		// The database was rolled back: reopen it directly (getDb() is locked)
		// and confirm the original row, not the staged one, is present.
		const restored = new Database(config.databasePath, { readonly: true });
		try {
			const row = restored.prepare('SELECT title FROM items WHERE id = ?').get('item-A') as
				{ title: string } | undefined;
			expect(row?.title).toBe('Original');
		} finally {
			restored.close();
		}

		expect(fs.readFileSync(path.join(config.customPlaybooksDir, 'a.yaml'), 'utf8')).toBe(
			'ORIGINAL_PLAYBOOK'
		);
		expect(fs.existsSync(path.join(config.customPlaybooksDir, 'b.yaml'))).toBe(false);

		expect(fs.readFileSync(path.join(config.attachmentsDir, 'ab', 'original-file'), 'utf8')).toBe(
			'ORIGINAL_ATTACHMENT'
		);
		expect(fs.existsSync(path.join(config.attachmentsDir, 'cd'))).toBe(false);

		// The failed commit must still leave RESTORE_PENDING latched: process
		// state is no longer trustworthy even though the files were rolled back.
		expect(isRestorePending()).toBe(true);
		expect(getRestorePending()?.safetyBackup).toMatch(/^pre-restore-.*\.zip$/);
		expect(() => getDb()).toThrow(DatabaseClosedForRestoreError);
	});

	it('leaves no leftover .replaced-* directories after a successful rollback', () => {
		const staged = buildStagedDirectory();
		const realRenameSync = fs.renameSync.bind(fs);
		let sabotaged = false;
		vi.spyOn(fs, 'renameSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
			if (!sabotaged && String(to) === config.attachmentsDir) {
				sabotaged = true;
				throw new Error('SIMULATED_RENAME_FAILURE');
			}
			return realRenameSync(from, to);
		}) as typeof fs.renameSync);

		expect(() => commitRestore(stagedAt(staged))).toThrow();
		vi.restoreAllMocks();

		const leftovers = fs.readdirSync(config.dataDir).filter((name) => name.includes('.replaced-'));
		expect(leftovers).toHaveLength(0);
	});

	it('leaves the process fully usable when creating the safety backup itself fails, before anything is latched', () => {
		const staged = buildStagedDirectory();
		vi.spyOn(fs, 'statfsSync').mockReturnValue({ bavail: 1, bsize: 1 } as fs.StatsFsBase<number>);

		expect(() => commitRestore(stagedAt(staged))).toThrow();

		vi.restoreAllMocks();
		// Nothing was latched: the original database is still open and usable,
		// exactly as if commitRestore had never been called.
		expect(isRestorePending()).toBe(false);
		expect(() => getDb()).not.toThrow();
		expect(getDb().prepare('SELECT title FROM items WHERE id = ?').get('item-A')).toMatchObject({
			title: 'Original'
		});
	});
});

describe('stageRestore', () => {
	it('accepts a valid relation snapshot and rejects one with a missing relation endpoint', () => {
		const snapshot = new Database(path.join(tmpDir, 'relation-snapshot.sqlite'));
		try {
			snapshot.pragma('foreign_keys = OFF');
			snapshot.exec(`
				CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
				INSERT INTO schema_migrations VALUES ('0015_item_relations', '2026-01-01T00:00:00.000Z');
				CREATE TABLE items (id TEXT PRIMARY KEY);
				CREATE TABLE item_relations (
					item_a_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
					item_b_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
					created_at TEXT NOT NULL,
					PRIMARY KEY (item_a_id, item_b_id),
					CHECK (item_a_id < item_b_id)
				);
				CREATE INDEX ix_item_relations_item_a ON item_relations(item_a_id);
				CREATE INDEX ix_item_relations_item_b ON item_relations(item_b_id);
				INSERT INTO items VALUES ('a');
				INSERT INTO items VALUES ('b');
				INSERT INTO item_relations VALUES ('a', 'b', '2026-01-01T00:00:00.000Z');
			`);
			expect(() => assertRestoreDatabaseValid(snapshot)).not.toThrow();
			snapshot.prepare("DELETE FROM items WHERE id = 'b'").run();
			expect(() => assertRestoreDatabaseValid(snapshot)).toThrow('DATABASE_FOREIGN_KEY_VIOLATION');
		} finally {
			snapshot.close();
		}
	});

	it('rejects relation migration and table presence mismatches', () => {
		const snapshot = new Database(path.join(tmpDir, 'relation-migration-mismatch.sqlite'));
		try {
			snapshot.exec(`
				CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
				INSERT INTO schema_migrations VALUES ('0015_item_relations', '2026-01-01T00:00:00.000Z');
			`);
			expect(() => assertRestoreDatabaseValid(snapshot)).toThrow(
				'DATABASE_INVALID_RELATION_SCHEMA'
			);

			snapshot.prepare('DELETE FROM schema_migrations').run();
			snapshot.exec(`
				CREATE TABLE items (id TEXT PRIMARY KEY);
				CREATE TABLE item_relations (
					item_a_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
					item_b_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
					created_at TEXT NOT NULL,
					PRIMARY KEY (item_a_id, item_b_id),
					CHECK (item_a_id < item_b_id)
				);
				CREATE INDEX ix_item_relations_item_a ON item_relations(item_a_id);
				CREATE INDEX ix_item_relations_item_b ON item_relations(item_b_id);
			`);
			expect(() => assertRestoreDatabaseValid(snapshot)).toThrow(
				'DATABASE_INVALID_RELATION_SCHEMA'
			);
		} finally {
			snapshot.close();
		}
	});

	it('rejects a relation snapshot whose schema permits non-canonical or self pairs', () => {
		const snapshot = new Database(path.join(tmpDir, 'invalid-relation-snapshot.sqlite'));
		try {
			snapshot.exec(`
				CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
				INSERT INTO schema_migrations VALUES ('0015_item_relations', '2026-01-01T00:00:00.000Z');
				CREATE TABLE items (id TEXT PRIMARY KEY);
				CREATE TABLE item_relations (
					item_a_id TEXT NOT NULL,
					item_b_id TEXT NOT NULL,
					created_at TEXT NOT NULL
				);
				CREATE INDEX ix_item_relations_item_a ON item_relations(item_a_id);
				CREATE INDEX ix_item_relations_item_b ON item_relations(item_b_id);
				INSERT INTO items VALUES ('a');
				INSERT INTO items VALUES ('b');
				INSERT INTO item_relations VALUES ('b', 'a', 'now');
			`);
			expect(() => assertRestoreDatabaseValid(snapshot)).toThrow(
				'DATABASE_INVALID_RELATION_SCHEMA'
			);
			snapshot.prepare('DELETE FROM item_relations').run();
			snapshot.prepare("INSERT INTO item_relations VALUES ('a', 'a', 'now')").run();
			expect(() => assertRestoreDatabaseValid(snapshot)).toThrow(
				'DATABASE_INVALID_RELATION_SCHEMA'
			);
		} finally {
			snapshot.close();
		}
	});

	it('rejects a schema with the canonical constraint text in a default but no active constraint', () => {
		const snapshot = new Database(path.join(tmpDir, 'inactive-relation-constraint.sqlite'));
		try {
			snapshot.exec(`
				CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
				INSERT INTO schema_migrations VALUES ('0015_item_relations', '2026-01-01T00:00:00.000Z');
				CREATE TABLE items (id TEXT PRIMARY KEY);
				CREATE TABLE item_relations (
					item_a_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
					item_b_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
					created_at TEXT NOT NULL DEFAULT 'CHECK (item_a_id < item_b_id)',
					PRIMARY KEY (item_a_id, item_b_id)
				);
				CREATE INDEX ix_item_relations_item_a ON item_relations(item_a_id);
				CREATE INDEX ix_item_relations_item_b ON item_relations(item_b_id);
				INSERT INTO items VALUES ('a');
				INSERT INTO items VALUES ('b');
				INSERT INTO item_relations VALUES ('a', 'b', '2026-01-01T00:00:00.000Z');
			`);

			expect(() => assertRestoreDatabaseValid(snapshot)).toThrow(
				'DATABASE_INVALID_RELATION_SCHEMA'
			);
		} finally {
			snapshot.close();
		}
	});

	it('rejects a schema whose unique timestamp constraint masks invalid relation probes', () => {
		const snapshot = new Database(path.join(tmpDir, 'unique-timestamp-relation-schema.sqlite'));
		try {
			snapshot.exec(`
				CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
				INSERT INTO schema_migrations VALUES ('0015_item_relations', '2026-01-01T00:00:00.000Z');
				CREATE TABLE items (id TEXT PRIMARY KEY);
				CREATE TABLE item_relations (
					item_a_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
					item_b_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
					created_at TEXT NOT NULL UNIQUE,
					PRIMARY KEY (item_a_id, item_b_id)
				);
				CREATE INDEX ix_item_relations_item_a ON item_relations(item_a_id);
				CREATE INDEX ix_item_relations_item_b ON item_relations(item_b_id);
			`);

			expect(() => assertRestoreDatabaseValid(snapshot)).toThrow(
				'DATABASE_INVALID_RELATION_SCHEMA'
			);
		} finally {
			snapshot.close();
		}
	});

	it('rejects a schema with a check tailored to the former relation probes', () => {
		const snapshot = new Database(path.join(tmpDir, 'probe-tailored-relation-schema.sqlite'));
		try {
			snapshot.exec(`
				CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
				INSERT INTO schema_migrations VALUES ('0015_item_relations', '2026-01-01T00:00:00.000Z');
				CREATE TABLE items (id TEXT PRIMARY KEY);
				CREATE TABLE item_relations (
					item_a_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
					item_b_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
					created_at TEXT NOT NULL,
					PRIMARY KEY (item_a_id, item_b_id),
					CHECK (created_at NOT IN ('b-a', 'c-c'))
				);
				CREATE INDEX ix_item_relations_item_a ON item_relations(item_a_id);
				CREATE INDEX ix_item_relations_item_b ON item_relations(item_b_id);
			`);

			expect(() => assertRestoreDatabaseValid(snapshot)).toThrow(
				'DATABASE_INVALID_RELATION_SCHEMA'
			);
		} finally {
			snapshot.close();
		}
	});

	it('rejects widened relation keys, cascading deletes, and incorrect endpoint indexes', () => {
		const snapshot = new Database(path.join(tmpDir, 'duplicate-relation-snapshot.sqlite'));
		try {
			snapshot.exec(`
				CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
				INSERT INTO schema_migrations VALUES ('0015_item_relations', '2026-01-01T00:00:00.000Z');
				CREATE TABLE items (id TEXT PRIMARY KEY);
				CREATE TABLE item_relations (
					item_a_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
					item_b_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
					created_at TEXT NOT NULL,
					PRIMARY KEY (item_a_id, item_b_id, created_at),
					CHECK (item_a_id < item_b_id)
				);
				CREATE INDEX ix_item_relations_item_a ON item_relations(item_b_id);
				CREATE INDEX ix_item_relations_item_b ON item_relations(item_a_id);
				INSERT INTO items VALUES ('a');
				INSERT INTO items VALUES ('b');
				INSERT INTO item_relations VALUES ('a', 'b', 'first');
				INSERT INTO item_relations VALUES ('a', 'b', 'second');
			`);
			expect(() => assertRestoreDatabaseValid(snapshot)).toThrow(
				'DATABASE_INVALID_RELATION_SCHEMA'
			);
		} finally {
			snapshot.close();
		}
	});

	it('rejects an archive whose migrations are newer than this build knows, and cleans up staging', () => {
		const dbBytes = new TextEncoder().encode('irrelevant for this check');
		const manifest: BackupManifest = {
			backupFormatVersion: 1,
			createdAt: '2026-01-01T00:00:00.000Z',
			app: { name: 'life-admin', version: '0.0.0' },
			schema: { migrationsApplied: ['9999_from_the_future'] },
			contents: [
				{
					kind: 'sqlite',
					path: 'db/lifeadmin.sqlite',
					bytes: dbBytes.byteLength,
					sha256: sha256(dbBytes)
				}
			]
		};
		const archivePath = writeCraftedArchive(manifest, dbBytes);

		return expect(stageRestore(archivePath))
			.rejects.toThrow('BACKUP_TOO_NEW')
			.then(() => {
				const leftovers = fs.existsSync(config.restoreStagingDir)
					? fs.readdirSync(config.restoreStagingDir)
					: [];
				expect(leftovers.filter((name) => name.startsWith('staged-'))).toHaveLength(0);
			});
	});

	it('rejects a staged archive whose relation migration has no relation table', async () => {
		const databasePath = path.join(tmpDir, 'missing-relation-table.sqlite');
		const snapshot = new Database(databasePath);
		snapshot.exec(`
			CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
			INSERT INTO schema_migrations VALUES ('0015_item_relations', '2026-01-01T00:00:00.000Z');
		`);
		snapshot.close();
		const dbBytes = fs.readFileSync(databasePath);
		const manifest: BackupManifest = {
			backupFormatVersion: 1,
			createdAt: '2026-01-01T00:00:00.000Z',
			app: { name: 'life-admin', version: '0.0.0' },
			schema: { migrationsApplied: listKnownMigrations() },
			contents: [
				{
					kind: 'sqlite',
					path: 'db/lifeadmin.sqlite',
					bytes: dbBytes.byteLength,
					sha256: sha256(dbBytes)
				}
			]
		};

		await expect(stageRestore(writeCraftedArchive(manifest, dbBytes))).rejects.toThrow(
			'DATABASE_INVALID_RELATION_SCHEMA'
		);
	});

	it('rejects an archive whose bytes do not match the manifest sha256, and cleans up staging', async () => {
		const declaredBytes = new TextEncoder().encode('what the manifest claims');
		const actualBytes = new TextEncoder().encode('something completely different');
		const manifest: BackupManifest = {
			backupFormatVersion: 1,
			createdAt: '2026-01-01T00:00:00.000Z',
			app: { name: 'life-admin', version: '0.0.0' },
			schema: { migrationsApplied: listKnownMigrations() },
			contents: [
				{
					kind: 'sqlite',
					path: 'db/lifeadmin.sqlite',
					bytes: declaredBytes.byteLength,
					sha256: sha256(declaredBytes)
				}
			]
		};
		const archivePath = writeCraftedArchive(manifest, actualBytes);

		await expect(stageRestore(archivePath)).rejects.toThrow('CHECKSUM_MISMATCH');
		const leftovers = fs.existsSync(config.restoreStagingDir)
			? fs.readdirSync(config.restoreStagingDir)
			: [];
		expect(leftovers.filter((name) => name.startsWith('staged-'))).toHaveLength(0);
	});

	it('rejects an archive whose "database" entry cannot be opened as SQLite at all, and cleans up staging', async () => {
		const garbage = new TextEncoder().encode('not a sqlite file, just garbage bytes');
		const manifest: BackupManifest = {
			backupFormatVersion: 1,
			createdAt: '2026-01-01T00:00:00.000Z',
			app: { name: 'life-admin', version: '0.0.0' },
			schema: { migrationsApplied: listKnownMigrations() },
			contents: [
				{
					kind: 'sqlite',
					path: 'db/lifeadmin.sqlite',
					bytes: garbage.byteLength,
					sha256: sha256(garbage)
				}
			]
		};
		const archivePath = writeCraftedArchive(manifest, garbage);

		// Whatever the exact underlying error (better-sqlite3 refuses to even
		// open a non-database file), it must not crash the process and must
		// not leave a staging directory behind.
		await expect(stageRestore(archivePath)).rejects.toThrow();
		const leftovers = fs.existsSync(config.restoreStagingDir)
			? fs.readdirSync(config.restoreStagingDir)
			: [];
		expect(leftovers.filter((name) => name.startsWith('staged-'))).toHaveLength(0);
	});

	it('accepts a valid, compatible archive and returns its manifest', async () => {
		// A hand-crafted manifest's sqlite entry is not a real database and
		// would fail integrity_check, so this uses createBackup()'s real
		// output, which is exactly what stageRestore has to accept.
		const backup = createBackup();
		const staged = await stageRestore(backup.filePath);
		expect(staged.manifest.contents.some((e) => e.kind === 'sqlite')).toBe(true);
		expect(fs.existsSync(path.join(staged.directory, 'lifeadmin.sqlite'))).toBe(true);
	});

	it('attaches an attachment reconciliation report to the staged result (clean for a backup with no attachments)', async () => {
		const backup = createBackup();
		const staged = await stageRestore(backup.filePath);
		expect(staged.attachmentReconciliation).toEqual({
			missingFiles: [],
			mismatchedFiles: [],
			orphanedFiles: [],
			invalidStorageKeys: []
		});
	});
});

describe('backup -> restore round trip (real data, not fabricated bytes)', () => {
	it('restores exactly the item, custom playbook, and attachment that were present at backup time', async () => {
		fs.writeFileSync(path.join(config.customPlaybooksDir, 'round-trip.yaml'), 'id: round-trip\n');
		getDb()
			.prepare(
				`INSERT INTO items (id, title, created_at, updated_at) VALUES ('item-B', 'Related', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
			)
			.run();
		getDb()
			.prepare(
				`INSERT INTO item_relations (item_a_id, item_b_id, created_at) VALUES ('item-A', 'item-B', '2026-01-01T00:00:00.000Z')`
			)
			.run();
		const backup = createBackup();

		// Change everything after the backup, so restoring is actually
		// observable rather than a no-op.
		getDb().prepare(`UPDATE items SET title = 'Changed after backup' WHERE id = 'item-A'`).run();
		getDb().prepare(`DELETE FROM item_relations WHERE item_a_id = 'item-A'`).run();
		fs.writeFileSync(path.join(config.customPlaybooksDir, 'a.yaml'), 'CHANGED_AFTER_BACKUP');
		fs.rmSync(path.join(config.customPlaybooksDir, 'round-trip.yaml'));

		commitRestore(await stageRestore(backup.filePath));

		const restoredDb = new Database(config.databasePath, { readonly: true });
		try {
			const row = restoredDb.prepare('SELECT title FROM items WHERE id = ?').get('item-A') as
				{ title: string } | undefined;
			expect(row?.title).toBe('Original');
			expect(
				restoredDb
					.prepare('SELECT item_a_id, item_b_id FROM item_relations WHERE item_a_id = ?')
					.get('item-A')
			).toEqual({ item_a_id: 'item-A', item_b_id: 'item-B' });
		} finally {
			restoredDb.close();
		}
		expect(fs.readFileSync(path.join(config.customPlaybooksDir, 'a.yaml'), 'utf8')).toBe(
			'ORIGINAL_PLAYBOOK'
		);
		expect(fs.existsSync(path.join(config.customPlaybooksDir, 'round-trip.yaml'))).toBe(true);
	});
});

describe('real attachment restore round trip (Finding 9)', () => {
	it('restores an attachment created through the production upload path: row, storage key, exact bytes, checksum and download lookup all survive', async () => {
		const originalBytes = new TextEncoder().encode('%PDF-1.4\n%%EOF');
		const ports = {
			items: itemsPort,
			cycles: cyclesPort,
			attachments: attachmentsPort,
			storage: attachmentStoragePort,
			ids: idsPort,
			clock: appClock
		};
		const added = addAttachment(ports, {
			itemId: 'item-A',
			filename: 'contract.pdf',
			bytes: originalBytes
		});
		attachmentsPort.rename('item-A', added.id, 'House contract');

		const backup = createBackup();

		// Change live state after the backup so restoring is actually
		// observable: remove the attachment through the same production path
		// (deletes both the row and the file) and add an unrelated one, so a
		// restore that failed to bring the original back would leave no trace
		// of it at all.
		removeAttachment(
			{ attachments: attachmentsPort, storage: attachmentStoragePort },
			'item-A',
			added.id
		);
		addAttachment(ports, {
			itemId: 'item-A',
			filename: 'unrelated.pdf',
			bytes: new TextEncoder().encode('%PDF-1.4\nunrelated\n%%EOF')
		});

		commitRestore(await stageRestore(backup.filePath));

		// Simulate the required restart: reopen the now-live database exactly
		// as a fresh process would.
		const reopened = openDatabase(config.databasePath);
		try {
			const item = reopened.prepare('SELECT title FROM items WHERE id = ?').get('item-A') as
				{ title: string } | undefined;
			expect(item?.title).toBe('Original');

			const row = reopened
				.prepare(
					'SELECT id, item_id, storage_key, filename, display_name, mime_type, byte_size, sha256 FROM attachments WHERE id = ?'
				)
				.get(added.id) as
				| {
						id: string;
						item_id: string;
						storage_key: string;
						filename: string;
						display_name: string | null;
						mime_type: string;
						byte_size: number;
						sha256: string;
				  }
				| undefined;
			expect(row).toBeDefined();
			expect(row!.item_id).toBe('item-A');
			expect(row!.storage_key).toBe(added.storageKey);
			expect(row!.filename).toBe('contract.pdf');
			expect(row!.display_name).toBe('House contract');
			expect(row!.byte_size).toBe(originalBytes.byteLength);
			expect(row!.sha256).toBe(added.sha256);

			// The unrelated attachment added after the backup must not survive
			// the restore either — it belongs to the live state, not the backup.
			const count = reopened.prepare('SELECT COUNT(*) AS n FROM attachments').get() as {
				n: number;
			};
			expect(count.n).toBe(1);
		} finally {
			reopened.close();
		}

		const restoredBytes = attachmentStoragePort.readBytes(added.storageKey);
		expect(Buffer.from(restoredBytes)).toEqual(Buffer.from(originalBytes));
		expect(attachmentStoragePort.sha256(restoredBytes)).toBe(added.sha256);

		// The production download lookup goes through the same getDb()
		// singleton every route uses, and that singleton stays permanently
		// latched (DatabaseClosedForRestoreError) for the rest of this
		// process — by design, restore requires a real restart. Proving the
		// lookup itself still works therefore needs a genuinely fresh module
		// generation, the same way a real process restart clears all
		// in-memory state, rather than reusing the now-latched singleton.
		vi.resetModules();
		const freshDb = await import('../db/database');
		const freshAppPorts = await import('../appPorts');
		const freshAttachments = await import('$lib/application/attachments/attachments');
		try {
			const forDownload = freshAttachments.getAttachmentForDownload(
				{
					items: freshAppPorts.itemsPort,
					attachments: freshAppPorts.attachmentsPort,
					storage: freshAppPorts.attachmentStoragePort
				},
				'item-A',
				added.id
			);
			expect(forDownload).not.toBeNull();
			expect(forDownload!.attachment.storageKey).toBe(added.storageKey);
			const streamed = await new Response(forDownload!.stream).bytes();
			expect(Buffer.from(streamed)).toEqual(Buffer.from(originalBytes));
		} finally {
			freshDb.closeDb();
		}
	});
});

describe('pre-Slice-7 backup compatibility (Finding 1)', () => {
	it('restores a backup whose snapshot predates the attachments migration, and the attachments table exists and is empty after the next startup', async () => {
		// Build an "old" snapshot: drop the attachments table and un-record
		// the migrations that created it, so reopening this file later (the
		// "restart") re-applies them from scratch, exactly like a real
		// pre-Slice-7 database would.
		// Only 0003 (attachments) is undone: 0004 already made a structural
		// change (an ALTER TABLE) that cannot be cleanly re-applied on top of
		// itself, unlike a plain CREATE TABLE, so undoing only the migration
		// this finding is actually about keeps the fixture realistic without
		// needing to hand-roll every historical schema version.
		const oldDbPath = path.join(tmpDir, 'old.sqlite');
		const oldDb = openDatabase(oldDbPath);
		oldDb.exec('DROP TABLE attachments');
		oldDb
			.prepare(
				`DELETE FROM schema_migrations WHERE version IN ('0003_attachments', '0014_attachment_display_name')`
			)
			.run();
		oldDb
			.prepare(
				`INSERT INTO items (id, title, created_at, updated_at) VALUES ('item-old', 'Pre-attachments item', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
			)
			.run();
		const appliedMigrations = listAppliedMigrations(oldDb);
		oldDb.close();
		const dbBytes = fs.readFileSync(oldDbPath);

		const manifest: BackupManifest = {
			backupFormatVersion: 1,
			createdAt: '2026-01-01T00:00:00.000Z',
			app: { name: 'life-admin', version: '0.0.0' },
			schema: { migrationsApplied: appliedMigrations },
			contents: [
				{
					kind: 'sqlite',
					path: 'db/lifeadmin.sqlite',
					bytes: dbBytes.byteLength,
					sha256: sha256(dbBytes)
				}
			]
		};
		const archivePath = writeCraftedArchive(manifest, dbBytes);

		const staged = await stageRestore(archivePath);
		expect(staged.attachmentReconciliation).toEqual({
			missingFiles: [],
			mismatchedFiles: [],
			orphanedFiles: [],
			invalidStorageKeys: []
		});
		commitRestore(staged);

		// Simulate the required restart: open the now-live file exactly as a
		// fresh process would, which runs the forward migrations.
		const reopened = openDatabase(config.databasePath);
		try {
			const item = reopened.prepare('SELECT title FROM items WHERE id = ?').get('item-old') as
				{ title: string } | undefined;
			expect(item?.title).toBe('Pre-attachments item');
			const table = reopened
				.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attachments'`)
				.get();
			expect(table).toBeDefined();
			expect(reopened.prepare('SELECT COUNT(*) AS n FROM attachments').get()).toEqual({ n: 0 });
		} finally {
			reopened.close();
		}
	});

	it('rejects a backup declaring no attachments migration whose archive nonetheless contains attachment entries', async () => {
		const oldDbPath = path.join(tmpDir, 'old2.sqlite');
		const oldDb = openDatabase(oldDbPath);
		oldDb.exec('DROP TABLE attachments');
		oldDb
			.prepare(
				`DELETE FROM schema_migrations WHERE version IN ('0003_attachments', '0014_attachment_display_name')`
			)
			.run();
		const appliedMigrations = listAppliedMigrations(oldDb);
		oldDb.close();
		const dbBytes = fs.readFileSync(oldDbPath);
		const attachmentBytes = new TextEncoder().encode('stray attachment bytes');
		const attachmentId = '11111111-1111-4111-8111-111111111111';

		const manifest: BackupManifest = {
			backupFormatVersion: 1,
			createdAt: '2026-01-01T00:00:00.000Z',
			app: { name: 'life-admin', version: '0.0.0' },
			schema: { migrationsApplied: appliedMigrations },
			contents: [
				{
					kind: 'sqlite',
					path: 'db/lifeadmin.sqlite',
					bytes: dbBytes.byteLength,
					sha256: sha256(dbBytes)
				},
				{
					kind: 'attachment',
					path: `attachments/11/${attachmentId}`,
					bytes: attachmentBytes.byteLength,
					sha256: sha256(attachmentBytes)
				}
			]
		};
		const body = writeArchive([
			{ name: 'manifest.json', body: new TextEncoder().encode(JSON.stringify(manifest)) },
			{ name: 'db/lifeadmin.sqlite', body: dbBytes },
			{ name: `attachments/11/${attachmentId}`, body: attachmentBytes }
		]);
		const archivePath = fs.mkdtempSync(path.join(tmpDir, 'crafted-')) + '.zip';
		fs.writeFileSync(archivePath, body);

		await expect(stageRestore(archivePath)).rejects.toThrow('ATTACHMENTS_WITHOUT_TABLE');
	});
});

describe('empty backup contents fully replace live directories (Finding 4)', () => {
	it('an empty backup (no playbook, no attachment entries) leaves both live directories empty after restore', async () => {
		// The current install has a custom playbook and an attachment file on
		// disk (set up in the shared beforeEach). The staged backup declares
		// neither, matching both "no custom playbooks were ever added" and
		// the pre-Slice-7 "attachments never existed" case.
		// Use a real, valid sqlite file so a real restore round trip is
		// exercised end to end rather than just the directory-swap mechanics.
		const realDbPath = path.join(tmpDir, 'empty-backup.sqlite');
		openDatabase(realDbPath).close();
		const realDbBytes = fs.readFileSync(realDbPath);

		const manifest: BackupManifest = {
			backupFormatVersion: 1,
			createdAt: '2026-01-01T00:00:00.000Z',
			app: { name: 'life-admin', version: '0.0.0' },
			schema: { migrationsApplied: listKnownMigrations() },
			contents: [
				{
					kind: 'sqlite',
					path: 'db/lifeadmin.sqlite',
					bytes: realDbBytes.byteLength,
					sha256: sha256(realDbBytes)
				}
			]
		};
		const archivePath = writeCraftedArchive(manifest, realDbBytes);

		commitRestore(await stageRestore(archivePath));

		expect(fs.readdirSync(config.customPlaybooksDir)).toEqual([]);
		expect(fs.readdirSync(config.attachmentsDir)).toEqual([]);
	});
});

describe('backup -> restore round trip with multiple cycles (Slice 8)', () => {
	it('an archive from a database with three cycles restores to three cycles, one ACTIVE, with the partial unique index satisfied', async () => {
		const { normalizePlaybook } = await import('$lib/domain/playbook/normalize');
		const { parsePlaybookStructure } = await import('$lib/domain/playbook/schema');
		const { materializePlaybook } = await import('$lib/domain/playbook/materialize');
		const { planNextCycleFields } = await import('$lib/domain/cycle/rollover');

		const parsed = parsePlaybookStructure({
			schemaVersion: 1,
			id: 'de.test.multi-cycle',
			version: '1.0.0',
			name: 'Multi-cycle test',
			fields: [{ key: 'note', type: 'text', label: 'Note' }],
			events: [],
			actions: [{ key: 'do_it', label: 'Do it' }]
		});
		if (!parsed.success) throw new Error('fixture invalid');
		const playbook = normalizePlaybook(parsed.data);

		const item = itemsPort.createItem({
			title: 'Multi-cycle item',
			note: null,
			playbook: {
				id: playbook.id,
				version: playbook.version,
				name: playbook.name,
				snapshot: playbook
			},
			materialization: materializePlaybook(playbook)
		});

		// Roll over twice: sequence 1 -> 2 -> 3, ending with cycle 3 ACTIVE.
		for (let i = 0; i < 2; i++) {
			const activeCycle = cyclesPort.getActiveCycle(item.id)!;
			const plan = materializePlaybook(playbook);
			cyclesPort.startNextCycle({
				itemId: item.id,
				completingCycleId: activeCycle.id,
				playbookVersion: playbook.version,
				fields: planNextCycleFields(plan, fieldsPort.listFields(activeCycle.id)),
				events: plan.events,
				actions: plan.actions
			});
		}

		const backup = createBackup();
		commitRestore(await stageRestore(backup.filePath));

		const reopened = openDatabase(config.databasePath);
		try {
			const cycles = reopened
				.prepare('SELECT sequence, status FROM cycles WHERE item_id = ? ORDER BY sequence')
				.all(item.id) as { sequence: number; status: string }[];
			expect(cycles.map((c) => c.sequence)).toEqual([1, 2, 3]);
			expect(cycles.filter((c) => c.status === 'ACTIVE')).toHaveLength(1);
			expect(cycles[2].status).toBe('ACTIVE');
			// The partial unique index (ux_cycles_single_active) is still
			// satisfied: a second ACTIVE insert would fail here too.
			expect(() =>
				reopened
					.prepare(
						`INSERT INTO cycles (id, item_id, sequence, status, created_at) VALUES ('x', ?, 99, 'ACTIVE', '2026-01-01T00:00:00.000Z')`
					)
					.run(item.id)
			).toThrow();
		} finally {
			reopened.close();
		}
	});
});

describe('backup -> restore Inbox round trip', () => {
	it('restores a pending Inbox row with its verified file', async () => {
		const storageKey = 'aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const bytes = Buffer.from('%PDF-1.4 pending inbox document');
		getDb()
			.prepare(
				`INSERT INTO inbox_documents
				 (id, storage_key, filename, mime_type, byte_size, sha256, suggestion_json, status, created_at, updated_at)
				 VALUES ('inbox-1', ?, 'pending.pdf', 'application/pdf', ?, ?, NULL, 'PENDING', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
			)
			.run(storageKey, bytes.byteLength, createHash('sha256').update(bytes).digest('hex'));
		fs.mkdirSync(path.join(config.inboxDir, 'aa'), { recursive: true });
		fs.writeFileSync(path.join(config.inboxDir, storageKey), bytes);

		const backup = createBackup();
		commitRestore(await stageRestore(backup.filePath));

		const restored = openDatabase(config.databasePath);
		try {
			expect(
				restored.prepare('SELECT filename, status FROM inbox_documents WHERE id = ?').get('inbox-1')
			).toEqual({
				filename: 'pending.pdf',
				status: 'PENDING'
			});
		} finally {
			restored.close();
		}
		expect(fs.readFileSync(path.join(config.inboxDir, storageKey))).toEqual(bytes);
	});
});
