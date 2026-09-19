import path from 'node:path';
import { isValidStorageKey } from '$lib/domain/attachment/attachment';

/**
 * Maps a storage key to a path under `root`, with two independent checks:
 * `isValidStorageKey` (a strict format regex) and a `path.resolve` plus
 * prefix check proving the result cannot land outside `root` even if the
 * regex alone had a bug. `root` is a parameter rather than a fixed
 * directory so the same containment logic covers both the live attachments
 * directory and a restore staging directory, which must apply the identical
 * rule to a `storage_key` that came from an untrusted (restored) database
 * row rather than the live one.
 *
 * Lives under `server/` (not in `domain/attachment/attachment.ts`, which
 * `node:path` would otherwise leak into) because that file is shared with
 * client-side Svelte components (e.g. AttachmentList.svelte), and Vite
 * externalizes any Node builtin import there for the browser bundle.
 */
export function resolveWithinAttachmentsRoot(root: string, key: string): string {
	if (!isValidStorageKey(key)) throw new Error('Invalid storage key');
	const resolvedRoot = path.resolve(root);
	const result = path.resolve(resolvedRoot, key);
	if (!result.startsWith(resolvedRoot + path.sep)) throw new Error('Invalid storage key');
	return result;
}
