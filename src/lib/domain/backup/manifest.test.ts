import { describe, expect, it } from 'vitest';
import { checkCompatibility, parseManifest } from './manifest';

const valid = {
	backupFormatVersion: 1,
	createdAt: '2026-09-08T00:00:00Z',
	app: { name: 'life-admin', version: '0.1.0' },
	schema: { migrationsApplied: ['0001_init'] },
	contents: [{ kind: 'sqlite', path: 'db/lifeadmin.sqlite', bytes: 1, sha256: 'a'.repeat(64) }]
};

describe('backup manifest', () => {
	it('accepts a safe version one manifest', () => expect(parseManifest(valid).ok).toBe(true));
	it('rejects unsafe paths and unknown kinds', () => {
		expect(
			parseManifest({ ...valid, contents: [{ ...valid.contents[0], path: '../db' }] })
		).toEqual({ ok: false, problem: 'UNSAFE_ENTRY_PATH' });
		expect(
			parseManifest({ ...valid, contents: [{ ...valid.contents[0], kind: 'future' }] })
		).toEqual({ ok: false, problem: 'UNKNOWN_ENTRY_KIND' });
	});
	it('rejects a manifest with a non-string app name or version', () => {
		expect(parseManifest({ ...valid, app: { name: 1, version: '0.1.0' } })).toEqual({
			ok: false,
			problem: 'NOT_A_BACKUP'
		});
		expect(parseManifest({ ...valid, app: { name: 'life-admin', version: null } })).toEqual({
			ok: false,
			problem: 'NOT_A_BACKUP'
		});
	});
	it('rejects a manifest whose migrationsApplied is not an array of strings', () => {
		expect(parseManifest({ ...valid, schema: { migrationsApplied: 'not-an-array' } })).toEqual({
			ok: false,
			problem: 'NOT_A_BACKUP'
		});
		expect(parseManifest({ ...valid, schema: { migrationsApplied: [1, 2] } })).toEqual({
			ok: false,
			problem: 'NOT_A_BACKUP'
		});
	});
	it('rejects two entries declaring the same path', () => {
		const entry = valid.contents[0];
		// Two sqlite-kind entries can only ever share the same path, since
		// isSafeEntryPath requires an exact match for kind 'sqlite'. That makes
		// DUPLICATE_ENTRY_PATH fire before the aggregate sqlite-count check
		// ever would, so DUPLICATE_SQLITE_ENTRY is effectively superseded: the
		// manifest is still safely rejected, just under this more general code.
		expect(
			parseManifest({
				...valid,
				contents: [entry, { ...entry, kind: 'sqlite', bytes: entry.bytes + 1 }]
			})
		).toEqual({ ok: false, problem: 'DUPLICATE_ENTRY_PATH' });
	});
	it('accepts a manifest listing sqlite, playbook and attachment entries together', () => {
		const attachment = {
			kind: 'attachment' as const,
			path: 'attachments/ab/12345678-1234-4123-8123-123456789012',
			bytes: 5,
			sha256: 'b'.repeat(64)
		};
		const playbook = {
			kind: 'playbook' as const,
			path: 'playbooks/nested/custom.yaml',
			bytes: 7,
			sha256: 'c'.repeat(64)
		};
		expect(
			parseManifest({ ...valid, contents: [valid.contents[0], playbook, attachment] }).ok
		).toBe(true);
	});
	it('rejects a format version other than the one this build knows', () => {
		expect(parseManifest({ ...valid, backupFormatVersion: 2 })).toEqual({
			ok: false,
			problem: 'UNSUPPORTED_FORMAT_VERSION'
		});
	});
	it('rejects a manifest with no sqlite entry at all', () => {
		expect(parseManifest({ ...valid, contents: [] })).toEqual({
			ok: false,
			problem: 'MISSING_SQLITE_ENTRY'
		});
	});
	it('rejects a backslash, a NUL byte, an over-deep path, a wrong extension, and a wrong sqlite path', () => {
		const entry = valid.contents[0];
		const rejected = (path: string, kind: (typeof entry)['kind'] = 'playbook') =>
			parseManifest({ ...valid, contents: [entry, { ...entry, kind, path }] }).ok === false;
		expect(rejected('playbooks\\evil.yaml')).toBe(true);
		expect(rejected('playbooks/evil\0.yaml')).toBe(true);
		expect(rejected('playbooks/a/b/c/d/e/f/g/h.yaml')).toBe(true); // past MAX_PATH_SEGMENTS
		expect(rejected('playbooks/not-a-playbook.txt')).toBe(true);
		expect(parseManifest({ ...valid, contents: [{ ...entry, path: 'db/other.sqlite' }] }).ok).toBe(
			false
		);
	});
	it('reports migration compatibility', () => {
		expect(checkCompatibility(['0001_init'], ['0001_init'])).toEqual({ kind: 'COMPATIBLE' });
		expect(checkCompatibility(['0001_init'], ['0001_init', '0002_auth'])).toEqual({
			kind: 'UPGRADE_ON_START',
			missing: ['0002_auth']
		});
		expect(checkCompatibility(['future'], ['0001_init'])).toEqual({
			kind: 'TOO_NEW',
			unknown: ['future']
		});
	});
});
