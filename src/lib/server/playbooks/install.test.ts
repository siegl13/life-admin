import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	countCustomPlaybookCandidates,
	installCustomPlaybook,
	uninstallCustomPlaybook,
	UnsafePlaybookDestinationError
} from './install';
import { loadPlaybookCatalog } from './catalog';

const roots: string[] = [];
function root(): string {
	const value = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-playbook-install-'));
	roots.push(value);
	return value;
}
afterEach(() =>
	roots.splice(0).forEach((value) => fs.rmSync(value, { recursive: true, force: true }))
);

describe('custom playbook filesystem installer', () => {
	it('writes a canonical file atomically and removes only a proven canonical file', () => {
		const custom = path.join(root(), 'playbooks');
		installCustomPlaybook({
			rootDir: custom,
			playbookId: 'de.test.install',
			yaml: 'valid',
			replace: false,
			provenCustomPath: null
		});
		const destination = path.join(custom, 'de.test.install.yaml');
		expect(fs.readFileSync(destination, 'utf8')).toBe('valid');
		expect(fs.readdirSync(custom).some((name) => name.endsWith('.tmp'))).toBe(false);
		uninstallCustomPlaybook({
			rootDir: custom,
			playbookId: 'de.test.install',
			provenCustomPath: destination
		});
		expect(fs.existsSync(destination)).toBe(false);
	});

	it('counts invalid YAML candidates and refuses unproven canonical ownership', () => {
		const custom = path.join(root(), 'playbooks');
		fs.mkdirSync(custom, { recursive: true });
		fs.writeFileSync(path.join(custom, 'broken.yaml'), 'not valid YAML: [');
		fs.writeFileSync(path.join(custom, 'de.test.install.yaml'), 'operator owned');
		expect(countCustomPlaybookCandidates(custom)).toBe(2);
		expect(() =>
			installCustomPlaybook({
				rootDir: custom,
				playbookId: 'de.test.install',
				yaml: 'new',
				replace: false,
				provenCustomPath: null
			})
		).toThrow(UnsafePlaybookDestinationError);
		expect(fs.readFileSync(path.join(custom, 'de.test.install.yaml'), 'utf8')).toBe(
			'operator owned'
		);
	});

	it('rejects replacement and uninstall through a noncanonical catalog path', () => {
		const custom = path.join(root(), 'playbooks');
		fs.mkdirSync(path.join(custom, 'nested'), { recursive: true });
		const nested = path.join(custom, 'nested', 'other.yaml');
		fs.writeFileSync(nested, 'operator owned');
		expect(() =>
			installCustomPlaybook({
				rootDir: custom,
				playbookId: 'de.test.install',
				yaml: 'new',
				replace: true,
				provenCustomPath: nested
			})
		).toThrow(UnsafePlaybookDestinationError);
		expect(() =>
			uninstallCustomPlaybook({
				rootDir: custom,
				playbookId: 'de.test.install',
				provenCustomPath: nested
			})
		).toThrow(UnsafePlaybookDestinationError);
		expect(fs.readFileSync(nested, 'utf8')).toBe('operator owned');
	});

	it('fails closed when YAML candidates are beyond the scan depth', () => {
		const custom = path.join(root(), 'playbooks');
		let nested = custom;
		for (let i = 0; i < 8; i++) {
			nested = path.join(nested, `level-${i}`);
			fs.mkdirSync(nested, { recursive: true });
		}
		fs.writeFileSync(path.join(nested, 'too-deep.yaml'), 'candidate');

		expect(countCustomPlaybookCandidates(custom)).toBe(101);
	});

	it('fails closed when an encountered child directory cannot be read', () => {
		const custom = path.join(root(), 'playbooks');
		const unreadable = path.join(custom, 'unreadable');
		fs.mkdirSync(unreadable, { recursive: true });
		const originalReaddirSync = fs.readdirSync;
		const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
		const readdirSync = vi.spyOn(fs, 'readdirSync').mockImplementation(((
			directory: fs.PathLike,
			options?: fs.ObjectEncodingOptions & { withFileTypes?: boolean }
		) => {
			if (directory === unreadable) throw error;
			return originalReaddirSync(directory, options as { withFileTypes: true });
		}) as typeof fs.readdirSync);

		try {
			expect(countCustomPlaybookCandidates(custom)).toBe(101);
		} finally {
			readdirSync.mockRestore();
		}
	});

	it('fails closed when scanning stops before later YAML candidates', () => {
		const custom = path.join(root(), 'playbooks');
		fs.mkdirSync(custom, { recursive: true });
		for (let i = 0; i < 500; i++) fs.writeFileSync(path.join(custom, `note-${i}`), 'ignored');
		for (let i = 0; i < 100; i++)
			fs.writeFileSync(path.join(custom, `candidate-${i}.yaml`), 'candidate');

		expect(countCustomPlaybookCandidates(custom)).toBeGreaterThanOrEqual(100);
	});

	it('counts YAML symlinks as candidates without following them', () => {
		const custom = path.join(root(), 'playbooks');
		fs.mkdirSync(custom, { recursive: true });
		fs.writeFileSync(path.join(custom, 'target'), 'candidate');
		fs.symlinkSync(path.join(custom, 'target'), path.join(custom, 'linked.yaml'));

		expect(countCustomPlaybookCandidates(custom)).toBe(1);
	});

	it('replaces a catalog-proven custom file and exposes the replacement after a rescan', () => {
		const custom = path.join(root(), 'playbooks');
		const bundled = path.join(root(), 'bundled');
		const destination = path.join(custom, 'de.test.install.yaml');
		fs.mkdirSync(custom, { recursive: true });
		fs.writeFileSync(
			destination,
			'schemaVersion: 1\nid: de.test.install\nversion: 1.0.0\nname: Installed\nfields: []\nevents: []\nactions: []\n'
		);
		const existing = loadPlaybookCatalog(bundled, custom).entries[0];
		installCustomPlaybook({
			rootDir: custom,
			playbookId: 'de.test.install',
			yaml: 'schemaVersion: 1\nid: de.test.install\nversion: 1.1.0\nname: Updated\nfields: []\nevents: []\nactions: []\n',
			replace: true,
			provenCustomPath: existing.filePath
		});
		const rescanned = loadPlaybookCatalog(bundled, custom);
		expect(rescanned.entries).toEqual([
			expect.objectContaining({ playbook: expect.objectContaining({ version: '1.1.0' }) })
		]);
	});
});
