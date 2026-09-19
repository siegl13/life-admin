import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import type { BackupManifest } from '$lib/domain/backup/manifest';
import packageJson from '../../../../package.json';

let tmpDir: string;
let config: (typeof import('../config'))['config'];
let getDb: (typeof import('../db/database'))['getDb'];
let closeDb: (typeof import('../db/database'))['closeDb'];
let createBackup: (typeof import('./createBackup'))['createBackup'];
let AttachmentBackupError: (typeof import('./createBackup'))['AttachmentBackupError'];
let BackupTooLargeError: (typeof import('./createBackup'))['BackupTooLargeError'];
let NotEnoughDiskSpaceError: (typeof import('./diskSpace'))['NotEnoughDiskSpaceError'];
let storeAttachment: (typeof import('../files/attachmentStorage'))['store'];
let sha256Bytes: (typeof import('../files/attachmentStorage'))['sha256'];

beforeEach(async () => {
	vi.resetModules();
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-createbackup-'));
	vi.stubEnv('LIFEADMIN_DATA_DIR', tmpDir);
	({ config } = await import('../config'));
	({ getDb, closeDb } = await import('../db/database'));
	({ createBackup, AttachmentBackupError, BackupTooLargeError } = await import('./createBackup'));
	({ store: storeAttachment, sha256: sha256Bytes } = await import('../files/attachmentStorage'));
	({ NotEnoughDiskSpaceError } = await import('./diskSpace'));
	getDb()
		.prepare(
			`INSERT INTO items (id, title, created_at, updated_at) VALUES ('item-1', 'Test item', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
		)
		.run();
});

afterEach(() => {
	vi.restoreAllMocks();
	closeDb();
	vi.unstubAllEnvs();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readManifest(filePath: string): BackupManifest {
	const zip = unzipSync(fs.readFileSync(filePath));
	return JSON.parse(Buffer.from(zip['manifest.json']).toString('utf8'));
}

function readArchiveEntry(filePath: string, entryPath: string): Buffer {
	const zip = unzipSync(fs.readFileSync(filePath));
	return Buffer.from(zip[entryPath]);
}

describe('createBackup / custom playbook discovery', () => {
	it('includes nested custom playbooks and skips an invalid file and a symlink without omitting valid ones', () => {
		const dir = config.customPlaybooksDir;
		fs.mkdirSync(path.join(dir, 'nested', 'deeper'), { recursive: true });
		fs.writeFileSync(path.join(dir, 'top.yaml'), 'id: top\nname: Top\n');
		fs.writeFileSync(path.join(dir, 'nested', 'deeper', 'child.yaml'), 'id: child\nname: Child\n');
		fs.writeFileSync(path.join(dir, 'broken.yaml'), 'id: [this is not closed\n');
		fs.symlinkSync(path.join(dir, 'top.yaml'), path.join(dir, 'escape.yaml'));

		const { filePath } = createBackup();
		const manifest = readManifest(filePath);
		const playbookPaths = manifest.contents.filter((e) => e.kind === 'playbook').map((e) => e.path);

		expect(playbookPaths).toContain('playbooks/top.yaml');
		expect(playbookPaths).toContain('playbooks/nested/deeper/child.yaml');
		expect(playbookPaths).not.toContain('playbooks/broken.yaml');
		expect(playbookPaths).not.toContain('playbooks/escape.yaml');
		expect(playbookPaths).toHaveLength(2);
	});

	it('produces a backup with no playbook entries when the directory does not exist', () => {
		const { filePath } = createBackup();
		const manifest = readManifest(filePath);
		expect(manifest.contents.filter((e) => e.kind === 'playbook')).toHaveLength(0);
	});
});

describe('createBackup / attachment storage_key containment', () => {
	it('fails the whole backup rather than reading outside the attachments root for a manipulated storage_key', () => {
		getDb()
			.prepare(
				`INSERT INTO attachments (id, item_id, filename, storage_key, mime_type, byte_size, sha256, uploaded_at)
				 VALUES ('att-evil', 'item-1', 'evil.pdf', ?, 'application/pdf', 10, ?, '2026-01-01T00:00:00.000Z')`
			)
			.run('../../../../etc/passwd', 'a'.repeat(64));

		expect(() => createBackup()).toThrow(AttachmentBackupError);
		try {
			createBackup();
			expect.unreachable();
		} catch (cause) {
			expect(cause).toBeInstanceOf(AttachmentBackupError);
			expect((cause as InstanceType<typeof AttachmentBackupError>).attachmentId).toBe('att-evil');
			// The malicious path itself must never appear in the error.
			expect(String(cause)).not.toContain('etc/passwd');
		}

		expect(fs.readdirSync(config.dataDir).filter((name) => name.endsWith('.zip'))).toHaveLength(0);
	});

	it('still backs up a legitimate attachment correctly', () => {
		const id = randomUUID();
		const bytes = new TextEncoder().encode('%PDF-1.4 fake pdf');
		const storageKey = storeAttachment(id, bytes);
		getDb()
			.prepare(
				`INSERT INTO attachments (id, item_id, filename, storage_key, mime_type, byte_size, sha256, uploaded_at)
				 VALUES (?, 'item-1', 'real.pdf', ?, 'application/pdf', ?, ?, '2026-01-01T00:00:00.000Z')`
			)
			.run(id, storageKey, bytes.byteLength, sha256Bytes(bytes));

		const { filePath } = createBackup();
		const manifest = readManifest(filePath);
		const attachmentPaths = manifest.contents
			.filter((e) => e.kind === 'attachment')
			.map((e) => e.path);
		expect(attachmentPaths).toEqual([`attachments/${storageKey}`]);
	});
});

describe('createBackup / manifest and snapshot correctness', () => {
	it('records accurate metadata: matching sha256/byte length, app version, and applied migrations', () => {
		const { filePath } = createBackup();
		const manifest = readManifest(filePath);

		expect(manifest.backupFormatVersion).toBe(1);
		expect(manifest.app).toEqual({ name: packageJson.name, version: packageJson.version });
		expect(manifest.schema.migrationsApplied).toEqual(
			expect.arrayContaining(['0001_init', '0002_auth'])
		);

		const dbEntry = manifest.contents.find((e) => e.kind === 'sqlite');
		const dbBytes = readArchiveEntry(filePath, 'db/lifeadmin.sqlite');
		expect(dbEntry?.bytes).toBe(dbBytes.byteLength);
		expect(dbEntry?.sha256).toBe(createHash('sha256').update(dbBytes).digest('hex'));
	});

	it('produces a snapshot that passes integrity_check and contains an item written just before the backup', () => {
		const { filePath } = createBackup();
		const dbBytes = readArchiveEntry(filePath, 'db/lifeadmin.sqlite');
		const snapshotPath = path.join(tmpDir, 'extracted.sqlite');
		fs.writeFileSync(snapshotPath, dbBytes);
		const snapshot = new Database(snapshotPath, { readonly: true });
		try {
			expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok');
			const row = snapshot.prepare('SELECT title FROM items WHERE id = ?').get('item-1') as
				{ title: string } | undefined;
			expect(row?.title).toBe('Test item');
		} finally {
			snapshot.close();
		}
	});

	it('sanitizes the snapshot: no sessions, an unchanged password_hash, reset lockout, and no secret.* settings', () => {
		getDb()
			.prepare(
				`INSERT INTO users (id, username, password_hash, failed_login_count, locked_until, created_at, updated_at, password_changed_at)
				 VALUES ('owner-1', 'owner', 'the-real-hash', 4, '2026-01-01T01:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
			)
			.run();
		getDb()
			.prepare(
				`INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
				 VALUES ('tok1', 'owner-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z')`
			)
			.run();
		getDb()
			.prepare(`INSERT INTO app_settings (key, value) VALUES ('secret.notify.ntfy.token', 'shh')`)
			.run();
		getDb().prepare(`INSERT INTO app_settings (key, value) VALUES ('ai.enabled', '1')`).run();

		const { filePath } = createBackup();
		const dbBytes = readArchiveEntry(filePath, 'db/lifeadmin.sqlite');
		const snapshotPath = path.join(tmpDir, 'sanitized.sqlite');
		fs.writeFileSync(snapshotPath, dbBytes);
		const snapshot = new Database(snapshotPath, { readonly: true });
		try {
			expect(snapshot.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
			const owner = snapshot.prepare('SELECT * FROM users WHERE id = ?').get('owner-1') as {
				password_hash: string;
				failed_login_count: number;
				locked_until: string | null;
			};
			expect(owner.password_hash).toBe('the-real-hash');
			expect(owner.failed_login_count).toBe(0);
			expect(owner.locked_until).toBeNull();
			expect(
				snapshot
					.prepare(`SELECT value FROM app_settings WHERE key = 'secret.notify.ntfy.token'`)
					.get()
			).toBeUndefined();
			expect(
				snapshot.prepare(`SELECT value FROM app_settings WHERE key = 'ai.enabled'`).get()
			).toEqual({ value: '1' });
		} finally {
			snapshot.close();
		}
	});
});

describe('createBackup / disk space and temp cleanup', () => {
	it('throws NotEnoughDiskSpaceError instead of writing an archive when free space is too low', () => {
		vi.spyOn(fs, 'statfsSync').mockReturnValue({ bavail: 1, bsize: 1 } as fs.StatsFsBase<number>);
		expect(() => createBackup()).toThrow(NotEnoughDiskSpaceError);
		expect(fs.readdirSync(config.dataDir).filter((name) => name.endsWith('.zip'))).toHaveLength(0);
	});

	it('removes its temp staging directory on both success and failure', () => {
		createBackup();
		expect(fs.readdirSync(config.dataDir).some((name) => name.startsWith('.backup-'))).toBe(false);

		getDb()
			.prepare(
				`INSERT INTO attachments (id, item_id, filename, storage_key, mime_type, byte_size, sha256, uploaded_at)
				 VALUES ('att-evil', 'item-1', 'evil.pdf', '../../../../etc/passwd', 'application/pdf', 10, ?, '2026-01-01T00:00:00.000Z')`
			)
			.run('a'.repeat(64));
		expect(() => createBackup()).toThrow();
		expect(fs.readdirSync(config.dataDir).some((name) => name.startsWith('.backup-'))).toBe(false);
	});
});

describe('createBackup / size symmetry with the restore-side limits (Finding 2)', () => {
	it('refuses a backup whose planned uncompressed content exceeds the restore-side total-bytes cap', () => {
		const id = randomUUID();
		const bytes = new Uint8Array(2000).fill(0x41);
		bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
		const storageKey = storeAttachment(id, bytes);
		getDb()
			.prepare(
				`INSERT INTO attachments (id, item_id, filename, storage_key, mime_type, byte_size, sha256, uploaded_at)
				 VALUES (?, 'item-1', 'big.pdf', ?, 'application/pdf', ?, ?, '2026-01-01T00:00:00.000Z')`
			)
			.run(id, storageKey, bytes.byteLength, sha256Bytes(bytes));

		expect(() =>
			createBackup({
				limits: { maxEntries: 1000, maxTotalBytes: 1000, maxArchiveBytes: 10_000_000 }
			})
		).toThrow(BackupTooLargeError);
		expect(fs.readdirSync(config.dataDir).filter((name) => name.endsWith('.zip'))).toHaveLength(0);
	});

	it('counts attachment bytes toward the planned total (not just the database)', () => {
		// Same as above, but proves specifically that an attachment (not the
		// tiny sqlite snapshot alone) is what pushes the plan over the cap.
		const id = randomUUID();
		const bytes = new Uint8Array(5000).fill(0x42);
		const storageKey = storeAttachment(id, bytes);
		getDb()
			.prepare(
				`INSERT INTO attachments (id, item_id, filename, storage_key, mime_type, byte_size, sha256, uploaded_at)
				 VALUES (?, 'item-1', 'huge.pdf', ?, 'application/pdf', ?, ?, '2026-01-01T00:00:00.000Z')`
			)
			.run(id, storageKey, bytes.byteLength, sha256Bytes(bytes));

		expect(() =>
			createBackup({
				limits: { maxEntries: 1000, maxTotalBytes: 3000, maxArchiveBytes: 10_000_000 }
			})
		).toThrow('PLANNED_SIZE_TOO_LARGE');
	});

	it('refuses a backup whose entry count exceeds the restore-side entry cap', () => {
		expect(() =>
			createBackup({
				limits: { maxEntries: 1, maxTotalBytes: 10_000_000, maxArchiveBytes: 10_000_000 }
			})
		).toThrow('TOO_MANY_ENTRIES');
	});

	it('never writes a file when the finished (compressed) archive exceeds the restore-side archive cap', () => {
		expect(() =>
			createBackup({ limits: { maxEntries: 1000, maxTotalBytes: 10_000_000, maxArchiveBytes: 10 } })
		).toThrow('COMPRESSED_ARCHIVE_TOO_LARGE');
		expect(fs.readdirSync(config.dataDir).filter((name) => name.endsWith('.zip'))).toHaveLength(0);
	});

	it('produces a backup that the current archive reader accepts, at the real (production) limits', async () => {
		const { extractArchive } = await import('./archive');
		const { filePath } = createBackup();
		const stagingDir = fs.mkdtempSync(path.join(tmpDir, 'extract-'));
		const manifest = await extractArchive(filePath, stagingDir);
		expect(manifest.contents.some((e) => e.kind === 'sqlite')).toBe(true);
		expect(fs.existsSync(path.join(stagingDir, 'lifeadmin.sqlite'))).toBe(true);
	});
});

describe('createBackup / concurrent requests use unique files (Finding 7)', () => {
	it('two backups created at the identical (frozen) timestamp get different filenames, and neither overwrites the other', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
		try {
			const first = createBackup();
			const second = createBackup();

			expect(first.filename).not.toBe(second.filename);
			expect(first.filePath).not.toBe(second.filePath);
			expect(fs.existsSync(first.filePath)).toBe(true);
			expect(fs.existsSync(second.filePath)).toBe(true);
			expect(fs.readFileSync(first.filePath)).not.toEqual(Buffer.alloc(0));
			expect(fs.readFileSync(second.filePath)).not.toEqual(Buffer.alloc(0));

			// Removing one (simulating the download route's stream-close
			// cleanup) must not affect the other.
			fs.rmSync(first.filePath, { force: true });
			expect(fs.existsSync(first.filePath)).toBe(false);
			expect(fs.existsSync(second.filePath)).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});
