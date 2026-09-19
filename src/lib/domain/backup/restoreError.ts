/**
 * Groups the internal restore failure reason codes (thrown as plain `Error`
 * messages by the backup/restore pipeline — see manifest.ts's ManifestProblem
 * and restore.ts) into a small set of categories with a genuinely distinct
 * user-facing recovery action. Several internal codes share one category on
 * purpose: "not a Life Admin backup" and "the archive is truncated/garbage"
 * are, in practice, the same failure (the manifest could not be read) with
 * the same fix (pick a different file), so they are not given separate
 * messages just to mirror the internal code list one-to-one.
 */
export type RestoreErrorCategory =
	| 'NOT_A_BACKUP'
	| 'UNSUPPORTED_FORMAT'
	| 'UNSAFE_CONTENTS'
	| 'TOO_LARGE'
	| 'INTEGRITY_FAILURE'
	| 'NOT_ENOUGH_DISK_SPACE'
	| 'UNKNOWN';

const REASON_TO_CATEGORY: Record<string, RestoreErrorCategory> = {
	// The archive could not be parsed as a Life Admin backup at all, whether
	// because it never was one or because it is damaged/truncated: both read
	// as "the manifest/structure could not be understood".
	NOT_A_BACKUP: 'NOT_A_BACKUP',
	UNKNOWN_ENTRY_KIND: 'NOT_A_BACKUP',
	MISSING_SQLITE_ENTRY: 'NOT_A_BACKUP',
	DUPLICATE_SQLITE_ENTRY: 'NOT_A_BACKUP',
	DUPLICATE_ENTRY_PATH: 'NOT_A_BACKUP',
	// A staged database with no attachments table (a valid pre-Slice-7
	// backup) whose staging directory has files anyway. No real backup this
	// app ever produced can be in that state.
	ATTACHMENTS_WITHOUT_TABLE: 'NOT_A_BACKUP',
	// The archive is a well-formed backup, just not one this version can
	// apply: either its own format version or the migrations it was built
	// against are newer than this installation knows.
	UNSUPPORTED_FORMAT_VERSION: 'UNSUPPORTED_FORMAT',
	BACKUP_TOO_NEW: 'UNSUPPORTED_FORMAT',
	// An entry's path failed the strict containment check. Distinct from
	// NOT_A_BACKUP because it is a content-safety rejection, not a structural
	// one, even though the recovery action a user sees is the same.
	UNSAFE_ENTRY_PATH: 'UNSAFE_CONTENTS',
	ARCHIVE_TOO_LARGE: 'TOO_LARGE',
	// A byte-for-byte mismatch: either the ZIP checksum step or SQLite's own
	// integrity_check caught corruption.
	CHECKSUM_MISMATCH: 'INTEGRITY_FAILURE',
	DATABASE_DAMAGED: 'INTEGRITY_FAILURE',
	DATABASE_FOREIGN_KEY_VIOLATION: 'INTEGRITY_FAILURE',
	DATABASE_INVALID_RELATIONS: 'INTEGRITY_FAILURE',
	DATABASE_INVALID_RELATION_SCHEMA: 'INTEGRITY_FAILURE',
	NOT_ENOUGH_DISK_SPACE: 'NOT_ENOUGH_DISK_SPACE'
};

/** Anything not in the table above (including a bare "unknown" fs error) is
 *  reported as UNKNOWN — never by forwarding the original message. */
export function categorizeRestoreFailure(reasonCode: string): RestoreErrorCategory {
	return REASON_TO_CATEGORY[reasonCode] ?? 'UNKNOWN';
}
