import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { MAX_PLAYBOOK_BYTES } from '$lib/domain/playbook/limits';

/**
 * Loads raw playbook YAML from disk. Playbooks are untrusted input (both
 * bundled and custom, per docs/adr/0003): this module never executes
 * anything from the file, disables YAML features that could be abused
 * (aliases/anchors/merge keys/custom tags), and bounds file size, file
 * count, and directory depth so a hostile or malformed file cannot hang
 * or crash the process.
 */

export { MAX_PLAYBOOK_BYTES };
export const MAX_PLAYBOOK_SCAN_FILES = 500;
export const MAX_PLAYBOOK_SCAN_DEPTH = 5;

export interface LoadedPlaybookFile {
	filePath: string;
	raw: unknown;
}

export interface PlaybookLoadError {
	filePath: string;
	reason: string;
}

export interface ScanResult {
	loaded: LoadedPlaybookFile[];
	errors: PlaybookLoadError[];
}

function isYamlFile(fileName: string): boolean {
	return fileName.endsWith('.yaml') || fileName.endsWith('.yml');
}

interface YamlProblem {
	code?: string;
	linePos?: readonly { line: number; col: number }[];
}

/**
 * Builds a safe, human-useful description of a YAML parse error/warning
 * without ever including the library's full pretty-printed message: that
 * message embeds a source-code excerpt of the offending line(s), which
 * would leak playbook file content into the Settings page and any logs
 * (see the "never log/display file contents" rule in docs/adr/0003).
 * `code` and `linePos` are safe, structured metadata with no source text.
 */
function describeYamlProblem(problem: YamlProblem): string {
	const location = problem.linePos?.[0]
		? ` at line ${problem.linePos[0].line}, column ${problem.linePos[0].col}`
		: '';
	return `${problem.code ?? 'YAML_PARSE_ERROR'}${location}`;
}

export function parsePlaybookText(source: string): unknown {
	if (Buffer.byteLength(source, 'utf8') > MAX_PLAYBOOK_BYTES) {
		throw new Error(`file exceeds the ${MAX_PLAYBOOK_BYTES} byte size limit`);
	}

	const doc = parseDocument(source, {
		merge: false,
		uniqueKeys: true,
		strict: true
	});
	const problems = [...doc.errors, ...doc.warnings];
	if (problems.length > 0) throw new Error(problems.map(describeYamlProblem).join('; '));
	return doc.toJS({ maxAliasCount: 0 });
}

export function loadPlaybookFile(filePath: string): LoadedPlaybookFile {
	if (!isYamlFile(path.basename(filePath)))
		throw new Error('playbook files must use a .yaml or .yml extension');
	const stat = fs.lstatSync(filePath);
	if (stat.isSymbolicLink()) {
		// Never follow a symlink: it could point outside the playbooks root.
		throw new Error('symlinks are not allowed as playbook files');
	}
	if (stat.size > MAX_PLAYBOOK_BYTES) {
		throw new Error(`file exceeds the ${MAX_PLAYBOOK_BYTES} byte size limit (${stat.size} bytes)`);
	}

	const source = fs.readFileSync(filePath, 'utf8');
	return { filePath, raw: parsePlaybookText(source) };
}

/**
 * Recursively scans a directory for .yaml/.yml files and parses each one.
 * A parse failure for one file never aborts the scan of the others: it is
 * collected as an error and the scan continues. Directory symlinks are
 * never followed; file symlinks are never read.
 */
export function scanPlaybookDirectory(rootDir: string): ScanResult {
	const loaded: LoadedPlaybookFile[] = [];
	const errors: PlaybookLoadError[] = [];
	let fileCount = 0;

	function walk(dir: string, depth: number): void {
		if (depth > MAX_PLAYBOOK_SCAN_DEPTH) return;

		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			// Directory does not exist (e.g. no custom playbooks configured yet).
			return;
		}

		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (fileCount >= MAX_PLAYBOOK_SCAN_FILES) return;
			const entryPath = path.join(dir, entry.name);

			if (entry.isSymbolicLink()) {
				fileCount++;
				errors.push({
					filePath: entryPath,
					reason: 'symlinks are not allowed in the playbooks directory'
				});
				continue;
			}
			if (entry.isDirectory()) {
				walk(entryPath, depth + 1);
				continue;
			}
			if (!entry.isFile() || !isYamlFile(entry.name)) continue;

			fileCount++;
			try {
				loaded.push(loadPlaybookFile(entryPath));
			} catch (err) {
				errors.push({
					filePath: entryPath,
					reason: err instanceof Error ? err.message : 'unknown parse error'
				});
			}
		}
	}

	walk(rootDir, 0);
	return { loaded, errors };
}
