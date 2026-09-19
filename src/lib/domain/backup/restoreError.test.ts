import { describe, expect, it } from 'vitest';
import { categorizeRestoreFailure } from './restoreError';

describe('categorizeRestoreFailure', () => {
	it('groups structural failures under NOT_A_BACKUP', () => {
		for (const reason of [
			'NOT_A_BACKUP',
			'UNKNOWN_ENTRY_KIND',
			'MISSING_SQLITE_ENTRY',
			'DUPLICATE_SQLITE_ENTRY',
			'DUPLICATE_ENTRY_PATH',
			'ATTACHMENTS_WITHOUT_TABLE'
		]) {
			expect(categorizeRestoreFailure(reason)).toBe('NOT_A_BACKUP');
		}
	});
	it('groups version/compatibility failures under UNSUPPORTED_FORMAT', () => {
		expect(categorizeRestoreFailure('UNSUPPORTED_FORMAT_VERSION')).toBe('UNSUPPORTED_FORMAT');
		expect(categorizeRestoreFailure('BACKUP_TOO_NEW')).toBe('UNSUPPORTED_FORMAT');
	});
	it('maps an unsafe path to UNSAFE_CONTENTS', () => {
		expect(categorizeRestoreFailure('UNSAFE_ENTRY_PATH')).toBe('UNSAFE_CONTENTS');
	});
	it('maps the size cap to TOO_LARGE', () => {
		expect(categorizeRestoreFailure('ARCHIVE_TOO_LARGE')).toBe('TOO_LARGE');
	});
	it('groups checksum and database integrity failures under INTEGRITY_FAILURE', () => {
		expect(categorizeRestoreFailure('CHECKSUM_MISMATCH')).toBe('INTEGRITY_FAILURE');
		expect(categorizeRestoreFailure('DATABASE_DAMAGED')).toBe('INTEGRITY_FAILURE');
		expect(categorizeRestoreFailure('DATABASE_FOREIGN_KEY_VIOLATION')).toBe('INTEGRITY_FAILURE');
		expect(categorizeRestoreFailure('DATABASE_INVALID_RELATIONS')).toBe('INTEGRITY_FAILURE');
		expect(categorizeRestoreFailure('DATABASE_INVALID_RELATION_SCHEMA')).toBe('INTEGRITY_FAILURE');
	});
	it('maps the disk-space code to NOT_ENOUGH_DISK_SPACE', () => {
		expect(categorizeRestoreFailure('NOT_ENOUGH_DISK_SPACE')).toBe('NOT_ENOUGH_DISK_SPACE');
	});
	it('falls back to UNKNOWN for anything not in the table, never forwarding it', () => {
		expect(categorizeRestoreFailure('ENOENT: no such file or directory')).toBe('UNKNOWN');
		expect(categorizeRestoreFailure('')).toBe('UNKNOWN');
	});
});
