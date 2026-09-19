import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { BACKUP_FORMAT_VERSION, type BackupManifest } from '$lib/domain/backup/manifest';
import {
	extractArchive,
	resolveEntryDestination,
	writeArchive,
	type ExtractLimits
} from './archive';

let tmpDir: string;
let archivePath: string;
let stagingDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-archive-'));
	archivePath = path.join(tmpDir, 'backup.zip');
	stagingDir = path.join(tmpDir, 'staging');
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function manifestFor(contents: BackupManifest['contents']): BackupManifest {
	return {
		backupFormatVersion: BACKUP_FORMAT_VERSION,
		createdAt: '2026-09-08T00:00:00.000Z',
		app: { name: 'life-admin', version: '0.0.0' },
		schema: { migrationsApplied: [] },
		contents
	};
}

function sha256(body: Uint8Array): string {
	return createHash('sha256').update(body).digest('hex');
}

/** Writes a real ZIP (via our own writer) so tests exercise the real container format. */
function writeRealArchive(
	manifest: BackupManifest,
	dataEntries: readonly { name: string; body: Uint8Array }[]
): void {
	const body = writeArchive([
		{ name: 'manifest.json', body: new TextEncoder().encode(JSON.stringify(manifest)) },
		...dataEntries
	]);
	fs.writeFileSync(archivePath, body);
}

const LOW_LIMITS: ExtractLimits = {
	maxArchiveBytes: 10 * 1024 * 1024,
	maxTotalBytes: 200,
	maxEntries: 3,
	maxPlaybookBytes: 100
};

describe('extractArchive (hostile ZIP policy)', () => {
	it('round-trips a small database entry through writeArchive and extractArchive', async () => {
		const db = new TextEncoder().encode('fake sqlite bytes');
		const manifest = manifestFor([
			{ kind: 'sqlite', path: 'db/lifeadmin.sqlite', bytes: db.byteLength, sha256: sha256(db) }
		]);
		writeRealArchive(manifest, [{ name: 'db/lifeadmin.sqlite', body: db }]);

		const result = await extractArchive(archivePath, stagingDir);

		expect(result.contents).toHaveLength(1);
		expect(fs.readFileSync(path.join(stagingDir, 'lifeadmin.sqlite'))).toEqual(Buffer.from(db));
	});

	it('rejects a directory entry', async () => {
		const manifest = manifestFor([
			{ kind: 'sqlite', path: 'db/lifeadmin.sqlite', bytes: 0, sha256: 'a'.repeat(64) }
		]);
		const body = zipSync({
			'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
			'evil/': new Uint8Array()
		});
		fs.writeFileSync(archivePath, body);

		await expect(extractArchive(archivePath, stagingDir)).rejects.toThrow();
	});

	it('rejects an entry that is not declared in the manifest', async () => {
		const manifest = manifestFor([
			{
				kind: 'sqlite',
				path: 'db/lifeadmin.sqlite',
				bytes: 3,
				sha256: sha256(new TextEncoder().encode('abc'))
			}
		]);
		const body = zipSync({
			'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
			'db/lifeadmin.sqlite': new TextEncoder().encode('abc'),
			'../../etc/passwd': new TextEncoder().encode('nope')
		});
		fs.writeFileSync(archivePath, body);

		await expect(extractArchive(archivePath, stagingDir)).rejects.toThrow();
		expect(fs.existsSync(path.resolve(stagingDir, '../../etc/passwd'))).toBe(false);
	});

	it('rejects a truncated / non-ZIP file without crashing', async () => {
		fs.writeFileSync(archivePath, Buffer.from('this is not a zip file'));
		await expect(extractArchive(archivePath, stagingDir)).rejects.toThrow();
	});

	it('rejects an archive with more entries than the configured cap', async () => {
		const bytes = new TextEncoder().encode('x');
		const manifest = manifestFor([
			{ kind: 'sqlite', path: 'db/lifeadmin.sqlite', bytes: 1, sha256: sha256(bytes) },
			{ kind: 'playbook', path: 'playbooks/a.yaml', bytes: 1, sha256: sha256(bytes) },
			{ kind: 'playbook', path: 'playbooks/b.yaml', bytes: 1, sha256: sha256(bytes) },
			{ kind: 'playbook', path: 'playbooks/c.yaml', bytes: 1, sha256: sha256(bytes) }
		]);
		writeRealArchive(manifest, [
			{ name: 'db/lifeadmin.sqlite', body: bytes },
			{ name: 'playbooks/a.yaml', body: bytes },
			{ name: 'playbooks/b.yaml', body: bytes },
			{ name: 'playbooks/c.yaml', body: bytes }
		]);

		await expect(extractArchive(archivePath, stagingDir, LOW_LIMITS)).rejects.toThrow();
	});

	it('rejects on real decompressed byte count, not on the entry declared uncompressed size', async () => {
		// Highly compressible payload: a few bytes on the wire, far past
		// maxTotalBytes once inflated. The cap must be enforced against what
		// the decompressor actually produced.
		const big = new Uint8Array(5000).fill(0x41);
		const manifest = manifestFor([
			{ kind: 'sqlite', path: 'db/lifeadmin.sqlite', bytes: big.byteLength, sha256: sha256(big) }
		]);
		writeRealArchive(manifest, [{ name: 'db/lifeadmin.sqlite', body: big }]);

		await expect(extractArchive(archivePath, stagingDir, LOW_LIMITS)).rejects.toThrow();
	});

	it('rejects a playbook entry over the per-entry playbook byte cap', async () => {
		const big = new Uint8Array(500).fill(0x41);
		const db = new TextEncoder().encode('ok');
		const manifest = manifestFor([
			{ kind: 'sqlite', path: 'db/lifeadmin.sqlite', bytes: db.byteLength, sha256: sha256(db) },
			{ kind: 'playbook', path: 'playbooks/big.yaml', bytes: big.byteLength, sha256: sha256(big) }
		]);
		writeRealArchive(manifest, [
			{ name: 'db/lifeadmin.sqlite', body: db },
			{ name: 'playbooks/big.yaml', body: big }
		]);

		await expect(
			extractArchive(archivePath, stagingDir, { ...LOW_LIMITS, maxTotalBytes: 10_000 })
		).rejects.toThrow();
	});

	it('rejects an archive larger than the compressed-size cap before parsing anything', async () => {
		fs.writeFileSync(archivePath, Buffer.alloc(1024, 1));
		await expect(
			extractArchive(archivePath, stagingDir, { ...LOW_LIMITS, maxArchiveBytes: 100 })
		).rejects.toThrow('ARCHIVE_TOO_LARGE');
	});
});

describe('resolveEntryDestination', () => {
	it('maps each kind to its fixed destination inside the staging root', () => {
		const root = '/staging';
		expect(
			resolveEntryDestination(root, {
				kind: 'sqlite',
				path: 'db/lifeadmin.sqlite',
				bytes: 0,
				sha256: 'a'.repeat(64)
			})
		).toBe(path.resolve(root, 'lifeadmin.sqlite'));
		expect(
			resolveEntryDestination(root, {
				kind: 'attachment',
				path: 'attachments/ab/12345678-1234-4123-8123-123456789012',
				bytes: 0,
				sha256: 'a'.repeat(64)
			})
		).toBe(path.resolve(root, 'attachments', 'ab', '12345678-1234-4123-8123-123456789012'));
		expect(
			resolveEntryDestination(root, {
				kind: 'inbox',
				path: 'inbox/ab/12345678-1234-4123-8123-123456789012',
				bytes: 0,
				sha256: 'a'.repeat(64)
			})
		).toBe(path.resolve(root, 'inbox', 'ab', '12345678-1234-4123-8123-123456789012'));
	});

	it('throws rather than resolve outside the staging root even for an already-validated-looking entry', () => {
		expect(() =>
			resolveEntryDestination('/staging', {
				kind: 'playbook',
				// Not a realistic manifest entry (parseManifest would already
				// reject it), but resolveEntryDestination is a second,
				// independent line of defense and must reject it too.
				path: 'playbooks/../../etc/passwd',
				bytes: 0,
				sha256: 'a'.repeat(64)
			})
		).toThrow('UNSAFE_ENTRY_PATH');
	});
});
