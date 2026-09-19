import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPlaybookFile, scanPlaybookDirectory } from './loader';

const FIXTURES_ROOT = path.join(process.cwd(), 'tests', 'fixtures', 'playbooks');
const INVALID_ROOT = path.join(FIXTURES_ROOT, 'invalid');
const VALID_ROOT = path.join(FIXTURES_ROOT, 'valid');

describe('scanPlaybookDirectory', () => {
	it('loads one requested YAML file without scanning sibling candidates', () => {
		const file = loadPlaybookFile(path.join(VALID_ROOT, 'minimal.yaml'));
		expect((file.raw as { id: string }).id).toBe('de.test.minimal');
	});

	it('rejects a requested file with a non-YAML extension', () => {
		expect(() => loadPlaybookFile(path.join(VALID_ROOT, 'minimal.txt'))).toThrow(/\.yaml or \.yml/);
	});

	it('loads a well-formed playbook file', () => {
		const result = scanPlaybookDirectory(VALID_ROOT);
		expect(result.errors).toEqual([]);
		expect(result.loaded).toHaveLength(1);
		expect((result.loaded[0].raw as { id: string }).id).toBe('de.test.minimal');
	});

	it('returns an empty scan for a directory that does not exist', () => {
		const result = scanPlaybookDirectory(path.join(FIXTURES_ROOT, 'does-not-exist'));
		expect(result).toEqual({ loaded: [], errors: [] });
	});

	it('never throws, even against a directory full of hostile files, and isolates each failure', () => {
		const result = scanPlaybookDirectory(INVALID_ROOT);
		// Every fixture file in this directory is expected to fail to load.
		expect(result.loaded).toEqual([]);
		const failedFiles = result.errors.map((e) => path.basename(e.filePath)).sort();
		expect(failedFiles).toEqual(
			[
				'alias-bomb.yaml',
				'custom-tag.yaml',
				'duplicate-keys.yaml',
				'malformed.yaml',
				'oversized.yaml',
				'symlink-escape.yaml'
			].sort()
		);
	});

	it('rejects an oversized file without reading its content into the error message', () => {
		const result = scanPlaybookDirectory(INVALID_ROOT);
		const oversized = result.errors.find((e) => e.filePath.endsWith('oversized.yaml'));
		expect(oversized).toBeDefined();
		expect(oversized!.reason).toMatch(/size limit/);
	});

	it('rejects a YAML alias bomb instead of expanding it', () => {
		const result = scanPlaybookDirectory(INVALID_ROOT);
		const bomb = result.errors.find((e) => e.filePath.endsWith('alias-bomb.yaml'));
		expect(bomb).toBeDefined();
	});

	it('never follows a symlink out of the playbooks root', () => {
		const result = scanPlaybookDirectory(INVALID_ROOT);
		const symlinked = result.errors.find((e) => e.filePath.endsWith('symlink-escape.yaml'));
		expect(symlinked).toBeDefined();
	});

	it('rejects a custom YAML tag (e.g. !!js/function) without leaking the source line into the error', () => {
		const result = scanPlaybookDirectory(INVALID_ROOT);
		const tagged = result.errors.find((e) => e.filePath.endsWith('custom-tag.yaml'));
		expect(tagged).toBeDefined();
		// Regression: the yaml library's own pretty-printed error message
		// embeds a source excerpt (e.g. the literal "!!js/function" line);
		// the loader must report only a code + location, never that excerpt.
		expect(tagged!.reason).not.toContain('js/function');
		expect(tagged!.reason).not.toContain('function(){return 1}');
	});

	it('rejects duplicate keys in the same document without leaking the source line into the error', () => {
		const result = scanPlaybookDirectory(INVALID_ROOT);
		const dup = result.errors.find((e) => e.filePath.endsWith('duplicate-keys.yaml'));
		expect(dup).toBeDefined();
		expect(dup!.reason).not.toContain('schemaVersion: 1\nschemaVersion');
	});

	it('isolates a malformed-YAML failure without aborting the scan', () => {
		const result = scanPlaybookDirectory(INVALID_ROOT);
		const malformed = result.errors.find((e) => e.filePath.endsWith('malformed.yaml'));
		expect(malformed).toBeDefined();
	});
});
