import { isValidStorageKey } from '$lib/domain/attachment/attachment';

export const BACKUP_FORMAT_VERSION = 1;
export type EntryKind = 'sqlite' | 'playbook' | 'attachment' | 'inbox';
export const KNOWN_ENTRY_KINDS: readonly EntryKind[] = [
	'sqlite',
	'playbook',
	'attachment',
	'inbox'
];

export interface ManifestEntry {
	kind: EntryKind;
	path: string;
	bytes: number;
	sha256: string;
}
export interface BackupManifest {
	backupFormatVersion: number;
	createdAt: string;
	app: { name: string; version: string };
	schema: { migrationsApplied: string[] };
	contents: ManifestEntry[];
}
export type ManifestProblem =
	| 'NOT_A_BACKUP'
	| 'UNSUPPORTED_FORMAT_VERSION'
	| 'UNKNOWN_ENTRY_KIND'
	| 'MISSING_SQLITE_ENTRY'
	| 'DUPLICATE_SQLITE_ENTRY'
	| 'DUPLICATE_ENTRY_PATH'
	| 'UNSAFE_ENTRY_PATH';
export type Compatibility =
	| { kind: 'COMPATIBLE' }
	| { kind: 'UPGRADE_ON_START'; missing: string[] }
	| { kind: 'TOO_NEW'; unknown: string[] };

// "playbooks" + up to 5 nested directories (the loader's own MAX_DEPTH) + the
// file itself is 7 segments. 8 leaves one segment of headroom while still
// rejecting anything deep enough to be suspicious. sqlite/attachment paths
// are far shorter and are additionally pinned to an exact shape below, so
// this generic cap only ever matters for playbook entries.
const MAX_PATH_SEGMENTS = 8;

export function isSafeEntryPath(value: string, kind: EntryKind): boolean {
	if (!value || value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
	const parts = value.split('/');
	if (
		parts.length > MAX_PATH_SEGMENTS ||
		parts.some((part) => !part || part === '..' || part === '.')
	)
		return false;
	if (kind === 'sqlite') return value === 'db/lifeadmin.sqlite';
	if (kind === 'playbook') return /^playbooks\/[A-Za-z0-9._/-]+\.ya?ml$/.test(value);
	// Reuses the exact storage-key format the attachment storage adapter
	// enforces (UUID v4, matching fan-out), so a manifest can never declare a
	// path shape the storage layer itself would refuse to serve.
	const root = kind === 'inbox' ? 'inbox/' : 'attachments/';
	return value.startsWith(root) && isValidStorageKey(value.slice(root.length));
}

export function parseManifest(
	raw: unknown
): { ok: true; manifest: BackupManifest } | { ok: false; problem: ManifestProblem } {
	if (!raw || typeof raw !== 'object') return { ok: false, problem: 'NOT_A_BACKUP' };
	const value = raw as Partial<BackupManifest>;
	if (value.backupFormatVersion !== BACKUP_FORMAT_VERSION)
		return { ok: false, problem: 'UNSUPPORTED_FORMAT_VERSION' };
	if (
		!Array.isArray(value.contents) ||
		typeof value.createdAt !== 'string' ||
		!value.app ||
		typeof value.app.name !== 'string' ||
		typeof value.app.version !== 'string' ||
		!value.schema ||
		!Array.isArray(value.schema.migrationsApplied) ||
		!value.schema.migrationsApplied.every((migration) => typeof migration === 'string')
	)
		return { ok: false, problem: 'NOT_A_BACKUP' };
	const seenPaths = new Set<string>();
	for (const entry of value.contents) {
		if (!entry || !KNOWN_ENTRY_KINDS.includes(entry.kind))
			return { ok: false, problem: 'UNKNOWN_ENTRY_KIND' };
		if (!isSafeEntryPath(entry.path, entry.kind))
			return { ok: false, problem: 'UNSAFE_ENTRY_PATH' };
		if (!Number.isInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256))
			return { ok: false, problem: 'NOT_A_BACKUP' };
		if (seenPaths.has(entry.path)) return { ok: false, problem: 'DUPLICATE_ENTRY_PATH' };
		seenPaths.add(entry.path);
	}
	const sqliteCount = value.contents.filter((entry) => entry.kind === 'sqlite').length;
	if (sqliteCount === 0) return { ok: false, problem: 'MISSING_SQLITE_ENTRY' };
	if (sqliteCount > 1) return { ok: false, problem: 'DUPLICATE_SQLITE_ENTRY' };
	return { ok: true, manifest: value as BackupManifest };
}

export function checkCompatibility(
	archiveMigrations: readonly string[],
	knownMigrations: readonly string[]
): Compatibility {
	const unknown = archiveMigrations.filter((migration) => !knownMigrations.includes(migration));
	if (unknown.length) return { kind: 'TOO_NEW', unknown };
	const missing = knownMigrations.filter((migration) => !archiveMigrations.includes(migration));
	return missing.length ? { kind: 'UPGRADE_ON_START', missing } : { kind: 'COMPATIBLE' };
}
