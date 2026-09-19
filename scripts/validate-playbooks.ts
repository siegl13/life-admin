/**
 * Build/CI gate: every BUNDLED playbook must be valid. Unlike the running
 * application (which skips an invalid bundled playbook and keeps serving
 * traffic), this script exits non-zero on any bundled failure so a broken
 * playbook never ships.
 *
 * Run standalone with tsx (not through Vite), so this file avoids any
 * Vite-only feature (import.meta.glob, $lib aliases) and imports the
 * domain modules by relative path instead.
 */
import path from 'node:path';
import { normalizePlaybook } from '../src/lib/domain/playbook/normalize.ts';
import { materializePlaybook } from '../src/lib/domain/playbook/materialize.ts';
import { parsePlaybookStructure } from '../src/lib/domain/playbook/schema.ts';
import { validatePlaybookSemantics } from '../src/lib/domain/playbook/semanticValidation.ts';
import { hasValidPlaybookFilename } from '../src/lib/domain/playbook/limits.ts';
import { loadPlaybookFile, scanPlaybookDirectory } from '../src/lib/server/playbooks/loader.ts';

const bundledDir = path.join(process.cwd(), 'playbooks', 'bundled');

function main(): number {
	const requestedPath = process.argv[2];
	const expectedFile = requestedPath ? path.resolve(requestedPath) : null;
	const result = expectedFile
		? (() => {
				try {
					return { loaded: [loadPlaybookFile(expectedFile)], errors: [] };
				} catch (error) {
					return {
						loaded: [],
						errors: [
							{
								filePath: expectedFile,
								reason: error instanceof Error ? error.message : 'unknown parse error'
							}
						]
					};
				}
			})()
		: scanPlaybookDirectory(bundledDir);
	const { loaded: selected, errors: loadErrors } = result;
	let failed = false;

	for (const error of loadErrors) {
		failed = true;
		console.error(`[load]      ${error.filePath}\n            ${error.reason}`);
	}

	if (selected.length === 0) {
		console.error(
			expectedFile
				? `No playbook found at ${expectedFile}.`
				: `No bundled playbooks found under ${bundledDir}.`
		);
		return 1;
	}

	for (const file of selected) {
		const structural = parsePlaybookStructure(file.raw);
		if (!structural.success) {
			failed = true;
			for (const issue of structural.error.issues) {
				console.error(
					`[structure] ${file.filePath}\n            ${issue.path.join('.')}: ${issue.message}`
				);
			}
			continue;
		}

		const semanticIssues = validatePlaybookSemantics(structural.data);
		if (semanticIssues.length > 0) {
			failed = true;
			for (const issue of semanticIssues) {
				console.error(`[semantic]  ${file.filePath}\n            ${issue.path}: ${issue.message}`);
			}
			continue;
		}

		// Golden path: normalize + materialize must not throw for any
		// bundled playbook.
		try {
			const normalized = normalizePlaybook(structural.data);
			if (!hasValidPlaybookFilename(normalized.id)) {
				failed = true;
				console.error(
					`[install]    ${file.filePath}\n            id is too long for a playbook filename`
				);
				continue;
			}
			materializePlaybook(normalized);
			console.log(
				`[ok]        ${file.filePath} (${structural.data.id}@${structural.data.version})`
			);
		} catch (err) {
			failed = true;
			console.error(`[materialize] ${file.filePath}\n            ${(err as Error).message}`);
		}
	}

	return failed ? 1 : 0;
}

process.exit(main());
