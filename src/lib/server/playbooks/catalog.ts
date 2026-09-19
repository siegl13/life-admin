import type { NormalizedPlaybook } from '$lib/domain/playbook/normalize';
import { normalizePlaybook } from '$lib/domain/playbook/normalize';
import { parsePlaybookStructure } from '$lib/domain/playbook/schema';
import { validatePlaybookSemantics } from '$lib/domain/playbook/semanticValidation';
import { scanPlaybookDirectory } from './loader';

/**
 * Loads, validates and normalizes every playbook from the bundled and
 * custom directories using the exact same engine (parse -> structural
 * validation -> semantic validation -> normalize). The only differences
 * between bundled and custom playbooks are the root directory and how a
 * caller reacts to failure:
 *
 * - scripts/validate-playbooks.ts treats any bundled failure as fatal
 *   (a build/CI gate).
 * - The running application treats every failure (bundled or custom) as
 *   "skip this one playbook, report it, keep going" — a malformed file
 *   must never be able to crash a running container.
 *
 * On an id collision between a bundled and a custom playbook, the bundled
 * one wins; the custom one is reported as a conflict and excluded.
 */

export type PlaybookSource = 'bundled' | 'custom';

export interface CatalogError {
	source: PlaybookSource;
	filePath: string;
	reason: string;
}

export interface CatalogEntry {
	source: PlaybookSource;
	filePath: string;
	playbook: NormalizedPlaybook;
}

export interface PlaybookCatalog {
	entries: CatalogEntry[];
	errors: CatalogError[];
	counts: {
		bundledValid: number;
		bundledInvalid: number;
		customValid: number;
		customInvalid: number;
	};
}

function loadAndValidate(rootDir: string, source: PlaybookSource) {
	const { loaded, errors: loadErrors } = scanPlaybookDirectory(rootDir);
	const entries: CatalogEntry[] = [];
	const errors: CatalogError[] = loadErrors.map((e) => ({
		source,
		filePath: e.filePath,
		reason: e.reason
	}));

	for (const file of loaded) {
		const structural = parsePlaybookStructure(file.raw);
		if (!structural.success) {
			errors.push({
				source,
				filePath: file.filePath,
				reason: `structural validation failed: ${structural.error.issues
					.map((i) => `${i.path.join('.')}: ${i.message}`)
					.join('; ')}`
			});
			continue;
		}

		const semanticIssues = validatePlaybookSemantics(structural.data);
		if (semanticIssues.length > 0) {
			errors.push({
				source,
				filePath: file.filePath,
				reason: `semantic validation failed: ${semanticIssues.map((i) => `${i.path}: ${i.message}`).join('; ')}`
			});
			continue;
		}

		entries.push({ source, filePath: file.filePath, playbook: normalizePlaybook(structural.data) });
	}

	return { entries, errors };
}

export function loadPlaybookCatalog(bundledDir: string, customDir: string): PlaybookCatalog {
	const bundled = loadAndValidate(bundledDir, 'bundled');
	const custom = loadAndValidate(customDir, 'custom');

	const byId = new Map<string, CatalogEntry>();
	for (const entry of bundled.entries) {
		byId.set(entry.playbook.id, entry);
	}

	const errors = [...bundled.errors, ...custom.errors];
	const finalEntries: CatalogEntry[] = [...bundled.entries];

	for (const entry of custom.entries) {
		if (byId.has(entry.playbook.id)) {
			errors.push({
				source: 'custom',
				filePath: entry.filePath,
				reason: `id "${entry.playbook.id}" conflicts with a bundled playbook; the bundled version is used`
			});
			continue;
		}
		byId.set(entry.playbook.id, entry);
		finalEntries.push(entry);
	}

	return {
		entries: finalEntries,
		errors,
		counts: {
			bundledValid: bundled.entries.length,
			bundledInvalid: bundled.errors.length,
			customValid: finalEntries.length - bundled.entries.length,
			customInvalid: errors.length - bundled.errors.length
		}
	};
}
