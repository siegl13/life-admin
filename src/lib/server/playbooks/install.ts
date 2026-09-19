import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_PLAYBOOK_SCAN_DEPTH, MAX_PLAYBOOK_SCAN_FILES } from './loader';

export class UnsafePlaybookDestinationError extends Error {}

const INSTALLATION_LIMIT_EXCEEDED = 101;

function canonicalPath(rootDir: string, playbookId: string): string {
	const root = path.resolve(rootDir);
	const destination = path.resolve(root, `${playbookId}.yaml`);
	if (!destination.startsWith(`${root}${path.sep}`)) throw new UnsafePlaybookDestinationError();
	return destination;
}

function isYamlCandidate(name: string): boolean {
	return name.endsWith('.yaml') || name.endsWith('.yml');
}

/** Counts every custom YAML candidate, including invalid files, to bound an
 * operator-controlled directory before accepting another uploaded candidate. */
export function countCustomPlaybookCandidates(rootDir: string): number {
	let count = 0;
	let scannedEntries = 0;
	function walk(dir: string, depth: number): void {
		if (count >= INSTALLATION_LIMIT_EXCEEDED) return;
		if (scannedEntries >= MAX_PLAYBOOK_SCAN_FILES) {
			// The catalog scan has a traversal cap. Treat an incomplete scan as
			// full so unscanned candidates cannot bypass the installation limit.
			count = INSTALLATION_LIMIT_EXCEEDED;
			return;
		}
		if (depth > MAX_PLAYBOOK_SCAN_DEPTH) {
			count = INSTALLATION_LIMIT_EXCEEDED;
			return;
		}
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch (error) {
			// A missing root is the normal initial state. Any other unreadable
			// directory makes the candidate count incomplete, so reject installs.
			if (depth === 0 && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
			count = INSTALLATION_LIMIT_EXCEEDED;
			return;
		}
		for (const entry of entries) {
			if (count >= INSTALLATION_LIMIT_EXCEEDED) return;
			if (scannedEntries >= MAX_PLAYBOOK_SCAN_FILES) {
				count = INSTALLATION_LIMIT_EXCEEDED;
				return;
			}
			scannedEntries++;
			if ((entry.isFile() || entry.isSymbolicLink()) && isYamlCandidate(entry.name)) count++;
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) walk(path.join(dir, entry.name), depth + 1);
		}
	}
	walk(rootDir, 0);
	return count;
}

export function installCustomPlaybook(input: {
	rootDir: string;
	playbookId: string;
	yaml: string;
	replace: boolean;
	provenCustomPath: string | null;
}): string {
	const destination = canonicalPath(input.rootDir, input.playbookId);
	const provenPath = input.provenCustomPath ? path.resolve(input.provenCustomPath) : null;
	const isReplacement = provenPath === destination;
	if (input.replace && !isReplacement) throw new UnsafePlaybookDestinationError();
	if (!input.replace && fs.existsSync(destination)) throw new UnsafePlaybookDestinationError();
	if (isReplacement) {
		try {
			if (!fs.lstatSync(destination).isFile()) throw new UnsafePlaybookDestinationError();
		} catch (error) {
			if (error instanceof UnsafePlaybookDestinationError) throw error;
			throw new UnsafePlaybookDestinationError();
		}
	}

	fs.mkdirSync(path.dirname(destination), { recursive: true });
	const tempPath = path.join(path.dirname(destination), `.${randomUUID()}.tmp`);
	try {
		const fd = fs.openSync(tempPath, 'wx', 0o600);
		try {
			fs.writeFileSync(fd, input.yaml, 'utf8');
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(tempPath, destination);
	} finally {
		fs.rmSync(tempPath, { force: true });
	}
	return `${input.playbookId}.yaml`;
}

export function uninstallCustomPlaybook(input: {
	rootDir: string;
	playbookId: string;
	provenCustomPath: string | null;
}): void {
	if (input.provenCustomPath === null) return;
	const destination = canonicalPath(input.rootDir, input.playbookId);
	if (path.resolve(input.provenCustomPath) !== destination)
		throw new UnsafePlaybookDestinationError();
	try {
		if (!fs.lstatSync(destination).isFile()) throw new UnsafePlaybookDestinationError();
	} catch (error) {
		if (error instanceof UnsafePlaybookDestinationError) throw error;
		return;
	}
	fs.unlinkSync(destination);
}
