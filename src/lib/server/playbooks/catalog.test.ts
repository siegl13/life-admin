import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPlaybookCatalog } from './catalog';

const BUNDLED_TEST_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'playbooks', 'valid');
const INVALID_FIXTURES_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'playbooks', 'invalid');

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-catalog-'));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadPlaybookCatalog', () => {
	it('loads the bundled bootstrap playbook with no errors', () => {
		const catalog = loadPlaybookCatalog(BUNDLED_TEST_DIR, tmpDir);
		expect(catalog.entries).toHaveLength(1);
		expect(catalog.entries[0].playbook.id).toBe('de.test.minimal');
		expect(catalog.entries[0].source).toBe('bundled');
		expect(catalog.errors).toEqual([]);
	});

	it('reports every invalid custom playbook and continues (never crashes)', () => {
		const catalog = loadPlaybookCatalog(BUNDLED_TEST_DIR, INVALID_FIXTURES_DIR);
		expect(catalog.entries).toHaveLength(1); // only the bundled one
		expect(catalog.errors.length).toBeGreaterThan(0);
		expect(catalog.errors.every((e) => e.source === 'custom')).toBe(true);
	});

	it('bundled wins on an id conflict; the custom one is reported and excluded', () => {
		fs.writeFileSync(
			path.join(tmpDir, 'conflict.yaml'),
			[
				'schemaVersion: 1',
				'id: de.test.minimal',
				'version: 9.9.9',
				'name: Malicious override'
			].join('\n')
		);

		const catalog = loadPlaybookCatalog(BUNDLED_TEST_DIR, tmpDir);
		expect(catalog.entries).toHaveLength(1);
		expect(catalog.entries[0].source).toBe('bundled');
		expect(catalog.entries[0].playbook.version).toBe('1.0.0');
		expect(catalog.errors.some((e) => e.reason.includes('conflicts with a bundled playbook'))).toBe(
			true
		);
	});

	it('skips a structurally invalid custom playbook and reports the reason', () => {
		fs.writeFileSync(
			path.join(tmpDir, 'broken.yaml'),
			['schemaVersion: 1', 'id: NotValidId', 'version: 1.0.0', 'name: Broken'].join('\n')
		);
		const catalog = loadPlaybookCatalog(BUNDLED_TEST_DIR, tmpDir);
		expect(catalog.entries).toHaveLength(1);
		expect(
			catalog.errors.some(
				(e) => e.filePath.endsWith('broken.yaml') && e.reason.includes('structural')
			)
		).toBe(true);
	});

	it('skips a semantically invalid custom playbook (dependency cycle) and reports the reason', () => {
		fs.writeFileSync(
			path.join(tmpDir, 'cyclic.yaml'),
			[
				'schemaVersion: 1',
				'id: de.test.cyclic',
				'version: 1.0.0',
				'name: Cyclic',
				'actions:',
				'  - key: a',
				'    label: A',
				'    dependsOn: [b]',
				'  - key: b',
				'    label: B',
				'    dependsOn: [a]'
			].join('\n')
		);
		const catalog = loadPlaybookCatalog(BUNDLED_TEST_DIR, tmpDir);
		expect(catalog.entries).toHaveLength(1);
		expect(
			catalog.errors.some(
				(e) => e.filePath.endsWith('cyclic.yaml') && e.reason.includes('semantic')
			)
		).toBe(true);
	});

	it('rejects a playbook containing an inline YAML merge key (<<) without crashing', () => {
		// merge:false in the loader disables `<<` merge semantics, so this
		// parses as a literal "<<" key rather than actually merging data in
		// — which then fails Zod's .strict() structural validation as an
		// unrecognized key, one layer further down the same pipeline every
		// other hostile fixture goes through.
		fs.writeFileSync(
			path.join(tmpDir, 'merge-key.yaml'),
			[
				'schemaVersion: 1',
				'id: de.test.mergekey',
				'version: 1.0.0',
				'name: Merge key attempt',
				'fields:',
				'  - key: x',
				'    type: text',
				'    label: X',
				'    <<: { recommended: true }'
			].join('\n')
		);
		const catalog = loadPlaybookCatalog(BUNDLED_TEST_DIR, tmpDir);
		expect(catalog.entries.some((e) => e.playbook.id === 'de.test.mergekey')).toBe(false);
		expect(catalog.errors.some((e) => e.filePath.endsWith('merge-key.yaml'))).toBe(true);
	});

	it('accepts a valid custom playbook alongside the bundled one', () => {
		fs.writeFileSync(
			path.join(tmpDir, 'custom-ok.yaml'),
			['schemaVersion: 1', 'id: de.custom.ok', 'version: 1.0.0', 'name: Custom OK'].join('\n')
		);
		const catalog = loadPlaybookCatalog(BUNDLED_TEST_DIR, tmpDir);
		expect(catalog.entries.map((e) => e.playbook.id).sort()).toEqual([
			'de.custom.ok',
			'de.test.minimal'
		]);
		expect(catalog.counts.customValid).toBe(1);
	});

	it('handles a missing custom directory gracefully', () => {
		const catalog = loadPlaybookCatalog(BUNDLED_TEST_DIR, path.join(tmpDir, 'nonexistent'));
		expect(catalog.entries).toHaveLength(1);
		expect(catalog.errors).toEqual([]);
	});
});

describe('the real bundled catalog (playbooks/bundled)', () => {
	const REAL_BUNDLED_DIR = path.join(process.cwd(), 'playbooks', 'bundled');

	it('never offers the bootstrap test fixture as a selectable playbook', () => {
		const catalog = loadPlaybookCatalog(REAL_BUNDLED_DIR, path.join(tmpDir, 'no-custom-dir'));
		expect(catalog.entries.some((e) => e.playbook.id === 'de.test.minimal')).toBe(false);
	});

	it('includes de.vehicle.tuv', () => {
		const catalog = loadPlaybookCatalog(REAL_BUNDLED_DIR, path.join(tmpDir, 'no-custom-dir'));
		expect(catalog.entries.some((e) => e.playbook.id === 'de.vehicle.tuv')).toBe(true);
		expect(catalog.errors).toEqual([]);
	});
});
