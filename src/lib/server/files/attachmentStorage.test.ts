import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentReadLimitError as AttachmentReadLimitErrorType } from '$lib/domain/attachment/attachment';

let tmpDir: string;
let config: (typeof import('../config'))['config'];
let log: (typeof import('../log'))['log'];
let AttachmentReadLimitError: typeof AttachmentReadLimitErrorType;
let resolveStoragePath: (typeof import('./attachmentStorage'))['resolveStoragePath'];
let store: (typeof import('./attachmentStorage'))['store'];
let readBytes: (typeof import('./attachmentStorage'))['readBytes'];
let remove: (typeof import('./attachmentStorage'))['remove'];
let cleanStalePartFiles: (typeof import('./attachmentStorage'))['cleanStalePartFiles'];
let cleanOrphanedAttachmentFiles: (typeof import('./attachmentStorage'))['cleanOrphanedAttachmentFiles'];

beforeEach(async () => {
	vi.resetModules();
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-attachment-storage-'));
	vi.stubEnv('LIFEADMIN_DATA_DIR', tmpDir);
	({ config } = await import('../config'));
	({ log } = await import('../log'));
	({ AttachmentReadLimitError } = await import('$lib/domain/attachment/attachment'));
	({
		resolveStoragePath,
		store,
		readBytes,
		remove,
		cleanStalePartFiles,
		cleanOrphanedAttachmentFiles
	} = await import('./attachmentStorage'));
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveStoragePath', () => {
	it('resolves a valid key to a path inside the attachments root', () => {
		const id = randomUUID();
		const key = `${id.slice(0, 2)}/${id}`;
		const resolved = resolveStoragePath(key);
		expect(resolved.startsWith(path.resolve(config.attachmentsDir) + path.sep)).toBe(true);
	});

	it('throws for a traversal, absolute, or malformed key and never writes outside the root', () => {
		for (const key of [
			'../../../etc/passwd',
			'/etc/passwd',
			'ab/not-a-uuid',
			`ab/${randomUUID()}/../../evil`
		]) {
			expect(() => resolveStoragePath(key)).toThrow();
		}
		// resolveStoragePath is pure validation, so a rejected key must have
		// created nothing anywhere in the data dir, inside or outside the root.
		expect(fs.readdirSync(tmpDir)).toEqual([]);
	});
});

describe('store / readBytes / remove', () => {
	it('stores bytes retrievably at the expected fan-out path and cleans up its .part file', () => {
		const id = randomUUID();
		const bytes = new TextEncoder().encode('hello attachment');
		const key = store(id, bytes);

		expect(key).toBe(`${id.slice(0, 2)}/${id}`);
		expect(Buffer.from(readBytes(key))).toEqual(Buffer.from(bytes));
		expect(fs.readdirSync(config.attachmentsTmpDir).some((name) => name.endsWith('.part'))).toBe(
			false
		);
	});

	it('rejects a file above the caller-provided read limit before allocating its contents', () => {
		const key = store(randomUUID(), new Uint8Array(4));
		expect(() => readBytes(key, 3)).toThrow(AttachmentReadLimitError);
	});

	it('remove() deletes an existing file', () => {
		const id = randomUUID();
		const key = store(id, new TextEncoder().encode('x'));
		remove(key);
		expect(fs.existsSync(resolveStoragePath(key))).toBe(false);
	});

	it('remove() does not throw for an already-missing file', () => {
		const id = randomUUID();
		const key = `${id.slice(0, 2)}/${id}`;
		expect(() => remove(key)).not.toThrow();
	});

	it('remove() logs a warning and does not throw when the filesystem operation fails for a real reason', () => {
		const id = randomUUID();
		const key = store(id, new TextEncoder().encode('x'));
		const warnSpy = vi.spyOn(log, 'warn');
		vi.spyOn(fs, 'rmSync').mockImplementation(() => {
			throw new Error('EACCES: permission denied');
		});

		expect(() => remove(key)).not.toThrow();
		expect(warnSpy).toHaveBeenCalledWith(
			'failed to remove attachment file',
			expect.objectContaining({ storageKey: key })
		);
	});
});

describe('cleanStalePartFiles', () => {
	it('removes only .part files, leaves other files alone, and is a no-op when the directory is missing', () => {
		expect(() => cleanStalePartFiles()).not.toThrow();

		fs.mkdirSync(config.attachmentsTmpDir, { recursive: true });
		fs.writeFileSync(path.join(config.attachmentsTmpDir, 'abandoned.part'), 'x');
		fs.writeFileSync(path.join(config.attachmentsTmpDir, 'not-a-part-file.txt'), 'y');

		cleanStalePartFiles();

		const remaining = fs.readdirSync(config.attachmentsTmpDir);
		expect(remaining).toEqual(['not-a-part-file.txt']);
	});
});

describe('cleanOrphanedAttachmentFiles', () => {
	it('removes an unreferenced completed file without touching a referenced attachment', () => {
		const retained = store(randomUUID(), new TextEncoder().encode('retained'));
		const orphaned = store(randomUUID(), new TextEncoder().encode('orphaned'));

		cleanOrphanedAttachmentFiles(new Set([retained]));

		expect(fs.existsSync(resolveStoragePath(retained))).toBe(true);
		expect(fs.existsSync(resolveStoragePath(orphaned))).toBe(false);
	});
});
