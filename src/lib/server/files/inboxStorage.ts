import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../config';
import { resolveWithinAttachmentsRoot } from './attachmentPath';
import { AttachmentReadLimitError, MAX_ATTACHMENT_BYTES } from '$lib/domain/attachment/attachment';

export const storageKeyForInbox = (id: string) => `${id.slice(0, 2)}/${id}`;
export const resolveInboxStoragePath = (key: string) =>
	resolveWithinAttachmentsRoot(config.inboxDir, key);
export function storeInbox(id: string, bytes: Uint8Array): string {
	const key = storageKeyForInbox(id);
	const destination = resolveInboxStoragePath(key);
	fs.mkdirSync(config.inboxTmpDir, { recursive: true });
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	const part = path.join(config.inboxTmpDir, `${id}.part`);
	try {
		const fd = fs.openSync(part, 'wx');
		try {
			fs.writeFileSync(fd, bytes);
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(part, destination);
		return key;
	} finally {
		fs.rmSync(part, { force: true });
	}
}
export function readInboxBytes(key: string, maxBytes = MAX_ATTACHMENT_BYTES): Uint8Array {
	const filePath = resolveInboxStoragePath(key);
	const fd = fs.openSync(filePath, 'r');
	try {
		const { size } = fs.fstatSync(fd);
		if (size > maxBytes) throw new AttachmentReadLimitError();
		const bytes = Buffer.allocUnsafe(size);
		if (fs.readSync(fd, bytes, 0, size, 0) !== size)
			throw new Error('inbox document changed while being read');
		return bytes;
	} finally {
		fs.closeSync(fd);
	}
}
export const removeInbox = (key: string) => {
	fs.rmSync(resolveInboxStoragePath(key), { force: true });
};
export const inboxSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Pending write scratch is never referenced by SQLite until the atomic rename completes. */
export function cleanStaleInboxPartFiles(): void {
	let entries: string[];
	try {
		entries = fs.readdirSync(config.inboxTmpDir);
	} catch {
		return;
	}
	for (const name of entries) {
		if (name.endsWith('.part')) fs.rmSync(path.join(config.inboxTmpDir, name), { force: true });
	}
}

export function cleanOrphanedInboxFiles(referencedStorageKeys: ReadonlySet<string>): void {
	cleanOrphanedFiles(config.inboxDir, referencedStorageKeys);
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
		const key = path.relative(config.inboxDir, entryPath).split(path.sep).join('/');
		if (!referencedStorageKeys.has(key)) {
			try {
				fs.rmSync(entryPath, { force: true });
			} catch {
				// Startup cleanup is best effort and never exposes resolved paths.
			}
		}
	}
}
