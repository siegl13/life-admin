import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { config } from '../config';
import { log } from '../log';
import { resolveWithinAttachmentsRoot } from './attachmentPath';
import { AttachmentReadLimitError } from '$lib/domain/attachment/attachment';
export const storageKeyFor = (id: string) => `${id.slice(0, 2)}/${id}`;
export function resolveStoragePath(key: string): string {
	return resolveWithinAttachmentsRoot(config.attachmentsDir, key);
}
export function store(id: string, bytes: Uint8Array): string {
	const key = storageKeyFor(id),
		dest = resolveStoragePath(key);
	fs.mkdirSync(config.attachmentsTmpDir, { recursive: true });
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	const part = path.join(config.attachmentsTmpDir, `${id}.part`);
	try {
		const fd = fs.openSync(part, 'wx');
		try {
			fs.writeFileSync(fd, bytes);
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(part, dest);
		return key;
	} finally {
		fs.rmSync(part, { force: true });
	}
}
export function readBytes(key: string, maxBytes?: number): Uint8Array {
	const filePath = resolveStoragePath(key);
	const fd = fs.openSync(filePath, 'r');
	try {
		const { size } = fs.fstatSync(fd);
		if (maxBytes !== undefined && size > maxBytes) throw new AttachmentReadLimitError();

		// The attachment store writes completed files by atomic rename and never
		// mutates them afterwards. Reading the statted length through this file
		// descriptor prevents stale database metadata from allocating an
		// unbounded buffer during extraction.
		const bytes = Buffer.allocUnsafe(size);
		const bytesRead = fs.readSync(fd, bytes, 0, size, 0);
		if (bytesRead !== size) throw new Error('attachment changed while being read');
		return bytes;
	} finally {
		fs.closeSync(fd);
	}
}
export const openReadStream = (key: string): ReadableStream<Uint8Array> =>
	Readable.toWeb(fs.createReadStream(resolveStoragePath(key))) as ReadableStream<Uint8Array>;
/**
 * Best effort: the row is already the source of truth once its own deletion
 * has succeeded, so a failure here (permissions, a already-vanished file) is
 * logged and swallowed rather than surfaced as a failed deletion to the user.
 * `force: true` already makes a missing file a no-op; this also catches any
 * other unexpected error so the caller never has to.
 */
export function remove(key: string): void {
	try {
		fs.rmSync(resolveStoragePath(key), { force: true });
	} catch (cause) {
		log.warn('failed to remove attachment file', {
			storageKey: key,
			reason: cause instanceof Error ? cause.message : 'unknown'
		});
	}
}

/** Removes `.part` files left behind by a `store()` call that never
 *  completed (e.g. the process was killed mid-write). Safe to call on every
 *  startup: a `.part` file is never anything but write-in-progress scratch
 *  data, and the finished attachment it would have become was never
 *  referenced by a database row. */
export function cleanStalePartFiles(): void {
	let entries: string[];
	try {
		entries = fs.readdirSync(config.attachmentsTmpDir);
	} catch {
		return;
	}
	for (const name of entries) {
		if (name.endsWith('.part'))
			fs.rmSync(path.join(config.attachmentsTmpDir, name), { force: true });
	}
}

export function cleanOrphanedAttachmentFiles(referencedStorageKeys: ReadonlySet<string>): void {
	cleanOrphanedFiles(config.attachmentsDir, referencedStorageKeys);
}

function cleanOrphanedFiles(root: string, referencedStorageKeys: ReadonlySet<string>): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			cleanOrphanedFiles(entryPath, referencedStorageKeys);
			continue;
		}
		const key = path.relative(config.attachmentsDir, entryPath).split(path.sep).join('/');
		if (!referencedStorageKeys.has(key)) {
			try {
				fs.rmSync(entryPath, { force: true });
			} catch {
				// Startup cleanup is best effort and never exposes resolved paths.
			}
		}
	}
}
export const sha256 = (bytes: Uint8Array): string =>
	createHash('sha256').update(bytes).digest('hex');
