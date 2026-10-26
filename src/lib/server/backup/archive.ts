import { Unzip, UnzipInflate, Zip, ZipDeflate, zipSync } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
	isSafeEntryPath,
	parseManifest,
	type BackupManifest,
	type ManifestEntry
} from '$lib/domain/backup/manifest';

export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
export const MAX_ENTRIES = 1000;
export const MAX_PLAYBOOK_BYTES = 128 * 1024;

export interface ExtractLimits {
	maxArchiveBytes: number;
	maxTotalBytes: number;
	maxEntries: number;
	maxPlaybookBytes: number;
}

const DEFAULT_LIMITS: ExtractLimits = {
	maxArchiveBytes: MAX_ARCHIVE_BYTES,
	maxTotalBytes: MAX_TOTAL_BYTES,
	maxEntries: MAX_ENTRIES,
	maxPlaybookBytes: MAX_PLAYBOOK_BYTES
};

export function writeArchive(entries: readonly { name: string; body: Uint8Array }[]): Uint8Array {
	return zipSync(Object.fromEntries(entries.map((entry) => [entry.name, entry.body])), {
		level: 6
	});
}

/** Writes one entry at a time, with a bounded buffer and no partial published archive. */
export function writeArchiveFromFiles(
	archivePath: string,
	manifest: Uint8Array,
	entries: readonly { name: string; filePath: string; bytes: number; sha256: string }[],
	maxArchiveBytes: number
): void {
	const partPath = `${archivePath}.part`;
	const output = fs.openSync(partPath, 'wx');
	let complete = false;
	let zip: Zip | undefined;
	try {
		let written = 0;
		zip = new Zip((error, chunk) => {
			if (error) throw error;
			if (written + chunk.byteLength > maxArchiveBytes)
				throw new Error('COMPRESSED_ARCHIVE_TOO_LARGE');
			let offset = 0;
			while (offset < chunk.byteLength) offset += fs.writeSync(output, chunk, offset);
			written += chunk.byteLength;
		});
		const manifestFile = new ZipDeflate('manifest.json', { level: 6 });
		zip.add(manifestFile);
		manifestFile.push(manifest, true);
		const buffer = Buffer.allocUnsafe(64 * 1024);
		for (const entry of entries) {
			const source = fs.openSync(entry.filePath, 'r');
			try {
				const hash = createHash('sha256');
				let size = 0;
				const file = new ZipDeflate(entry.name, { level: 6 });
				zip.add(file);
				let count: number;
				while ((count = fs.readSync(source, buffer, 0, buffer.byteLength, null)) > 0) {
					const chunk = buffer.subarray(0, count);
					size += count;
					if (size > entry.bytes) throw new Error('FILE_CHANGED_DURING_BACKUP');
					hash.update(chunk);
					file.push(chunk);
				}
				if (size !== entry.bytes || hash.digest('hex') !== entry.sha256)
					throw new Error('FILE_CHANGED_DURING_BACKUP');
				file.push(new Uint8Array(), true);
			} finally {
				fs.closeSync(source);
			}
		}
		zip.end();
		fs.fsyncSync(output);
		fs.closeSync(output);
		fs.renameSync(partPath, archivePath);
		complete = true;
	} finally {
		if (!complete) {
			zip?.terminate();
			try {
				fs.closeSync(output);
			} catch {
				// Already closed before a failed rename.
			}
			fs.rmSync(partPath, { force: true });
		}
	}
}

/**
 * Maps a manifest entry to its on-disk destination under a staging root, with
 * TWO INDEPENDENT checks: `isSafeEntryPath` (a strict per-kind pattern) and a
 * `path.resolve` + prefix check proving the result cannot land outside
 * `stagingRoot` even if the pattern above had a bug. Shared by the archive
 * reader and by restore's checksum-verification pass so both trust the exact
 * same mapping.
 */
export function resolveEntryDestination(stagingRoot: string, entry: ManifestEntry): string {
	if (!isSafeEntryPath(entry.path, entry.kind)) throw new Error('UNSAFE_ENTRY_PATH');
	const root = path.resolve(stagingRoot);
	const destination =
		entry.kind === 'sqlite'
			? path.join(root, 'lifeadmin.sqlite')
			: path.join(
					root,
					entry.kind === 'playbook'
						? 'playbooks'
						: entry.kind === 'inbox'
							? 'inbox'
							: 'attachments',
					...entry.path.split('/').slice(1)
				);
	const resolved = path.resolve(destination);
	if (resolved !== destination || !resolved.startsWith(root + path.sep))
		throw new Error('UNSAFE_ENTRY_PATH');
	return resolved;
}

/** Archive input is hostile. fflate decompresses; this function owns policy. */
export async function extractArchive(
	archivePath: string,
	stagingDir: string,
	limits: ExtractLimits = DEFAULT_LIMITS
): Promise<BackupManifest> {
	const stat = fs.statSync(archivePath);
	if (stat.size > limits.maxArchiveBytes) throw new Error('ARCHIVE_TOO_LARGE');
	return await new Promise((resolve, reject) => {
		let manifest: BackupManifest | null = null;
		const seenPaths = new Set<string>();
		let total = 0;
		let count = 0;
		let failed = false;
		const fail = (cause: unknown) => {
			if (!failed) {
				failed = true;
				reject(cause instanceof Error ? cause : new Error('NOT_A_BACKUP'));
			}
		};
		const unzip = new Unzip((file) => {
			count += 1;
			// Directory entries and anything past the entry cap are rejected
			// outright: a backup archive only ever contains regular files.
			if (count > limits.maxEntries || file.name.endsWith('/'))
				return fail(new Error('NOT_A_BACKUP'));
			if (count === 1 && file.name !== 'manifest.json') return fail(new Error('NOT_A_BACKUP'));
			if (file.name === 'manifest.json') {
				const chunks: Uint8Array[] = [];
				let bytes = 0;
				file.ondata = (error, chunk, final) => {
					if (error) return fail(error);
					bytes += chunk.byteLength;
					if (bytes > limits.maxPlaybookBytes) return fail(new Error('NOT_A_BACKUP'));
					chunks.push(chunk);
					if (final) {
						try {
							const body = Buffer.concat(chunks.map((value) => Buffer.from(value)));
							const parsed = parseManifest(JSON.parse(body.toString('utf8')));
							if (!parsed.ok) return fail(new Error(parsed.problem));
							manifest = parsed.manifest;
							total += body.byteLength;
						} catch (cause) {
							fail(cause);
						}
					}
				};
				file.start();
				return;
			}
			if (!manifest) return fail(new Error('NOT_A_BACKUP'));
			// Every non-manifest entry must be declared, by exact path, in the
			// manifest we already validated. An extra entry the manifest never
			// mentioned (or a second copy of a declared path) is rejected: it
			// cannot be reasoned about and must never reach disk.
			if (seenPaths.has(file.name)) return fail(new Error('NOT_A_BACKUP'));
			seenPaths.add(file.name);
			const entry = manifest.contents.find((candidate) => candidate.path === file.name);
			if (!entry) return fail(new Error('UNSAFE_ENTRY_PATH'));
			let destination: string;
			try {
				destination = resolveEntryDestination(stagingDir, entry);
			} catch (cause) {
				return fail(cause);
			}
			fs.mkdirSync(path.dirname(destination), { recursive: true });
			const fd = fs.openSync(destination, 'wx');
			let entryBytes = 0;
			file.ondata = (error, chunk, final) => {
				if (error) {
					fs.closeSync(fd);
					return fail(error);
				}
				entryBytes += chunk.byteLength;
				total += chunk.byteLength;
				// The cap is enforced against bytes actually produced by the
				// decompressor, never against the entry's declared (attacker-
				// controlled) size, so a decompression bomb is caught
				// regardless of what the ZIP header claims.
				if (
					total > limits.maxTotalBytes ||
					(entry.kind === 'playbook' && entryBytes > limits.maxPlaybookBytes)
				) {
					fs.closeSync(fd);
					return fail(new Error('ARCHIVE_TOO_LARGE'));
				}
				fs.writeSync(fd, chunk);
				if (final) fs.closeSync(fd);
			};
			file.start();
		});
		unzip.register(UnzipInflate);
		const input = fs.createReadStream(archivePath);
		input.on('data', (chunk) => {
			if (!failed) {
				try {
					unzip.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk, false);
				} catch (cause) {
					fail(cause);
				}
			}
		});
		input.on('error', fail);
		input.on('end', () => {
			if (failed) return;
			try {
				unzip.push(new Uint8Array(), true);
				if (!manifest) return fail(new Error('NOT_A_BACKUP'));
				resolve(manifest);
			} catch (cause) {
				fail(cause);
			}
		});
	});
}
