import fs from 'node:fs';
import { log } from '../log';

export class NotEnoughDiskSpaceError extends Error {}

/**
 * A rough, deliberately generous margin: backup uses it against the current
 * database size, restore against the uploaded archive size (which expands on
 * extraction). 3x is enough headroom for a VACUUM INTO temp copy plus the
 * final archive, without pretending to compute an exact requirement.
 */
export const DISK_SPACE_SAFETY_FACTOR = 3;

/**
 * Throws NotEnoughDiskSpaceError when the filesystem containing `dir` has
 * fewer than `requiredBytes` available. A failure to even determine free
 * space (an unusual filesystem, a platform quirk) is treated as "space
 * unknown" and allowed to proceed — this check exists to fail fast on a
 * definite shortage, not to become a new way for backup/restore to break.
 */
export function assertEnoughFreeSpace(dir: string, requiredBytes: number): void {
	let stats: fs.StatsFsBase<number>;
	try {
		stats = fs.statfsSync(dir);
	} catch (cause) {
		log.warn('could not determine free disk space; proceeding anyway', {
			reason: cause instanceof Error ? cause.message : 'unknown'
		});
		return;
	}
	const availableBytes = stats.bavail * stats.bsize;
	if (availableBytes < requiredBytes) {
		throw new NotEnoughDiskSpaceError('NOT_ENOUGH_DISK_SPACE');
	}
}
