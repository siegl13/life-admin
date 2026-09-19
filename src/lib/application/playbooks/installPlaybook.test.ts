import { describe, expect, it, vi } from 'vitest';
import { installPlaybook, MAX_CUSTOM_PLAYBOOKS, PlaybookInstallError } from './installPlaybook';

const valid = {
	schemaVersion: 1,
	id: 'de.test.installed',
	version: '1.0.0',
	name: 'Installed',
	fields: [],
	events: [],
	actions: []
};

describe('installPlaybook', () => {
	it('requires replacement for an installed custom id and permits a proven replacement at the limit', () => {
		const install = vi.fn();
		const ports = {
			installer: {
				parse: vi.fn(() => valid),
				install,
				countCustom: vi.fn(() => MAX_CUSTOM_PLAYBOOKS)
			}
		};
		expect(() =>
			installPlaybook(ports, {
				yaml: 'yaml',
				replace: false,
				installed: [
					{
						id: valid.id,
						version: '0.9.0',
						source: 'custom',
						filePath: '/custom/de.test.installed.yaml'
					}
				]
			})
		).toThrow(PlaybookInstallError);
		installPlaybook(ports, {
			yaml: 'yaml',
			replace: true,
			installed: [
				{
					id: valid.id,
					version: '0.9.0',
					source: 'custom',
					filePath: '/custom/de.test.installed.yaml'
				}
			]
		});
		expect(install).toHaveBeenCalledWith(
			expect.objectContaining({ replace: true, provenCustomPath: '/custom/de.test.installed.yaml' })
		);
	});

	it('rejects a new id at the candidate limit before writing', () => {
		const install = vi.fn();
		const ports = {
			installer: {
				parse: vi.fn(() => valid),
				install,
				countCustom: vi.fn(() => MAX_CUSTOM_PLAYBOOKS)
			}
		};
		expect(() => installPlaybook(ports, { yaml: 'yaml', replace: false, installed: [] })).toThrow(
			PlaybookInstallError
		);
		expect(install).not.toHaveBeenCalled();
	});

	it('does not pass replacement mode for a new id', () => {
		const install = vi.fn();
		const ports = {
			installer: {
				parse: vi.fn(() => valid),
				install,
				countCustom: vi.fn(() => 0)
			}
		};

		installPlaybook(ports, { yaml: 'yaml', replace: true, installed: [] });
		expect(install).toHaveBeenCalledWith(
			expect.objectContaining({ replace: false, provenCustomPath: null })
		);
	});

	it('rejects an id that would exceed the filesystem filename limit', () => {
		const ports = {
			installer: {
				parse: vi.fn(() => ({ ...valid, id: `de.${'a'.repeat(248)}` })),
				install: vi.fn(),
				countCustom: vi.fn()
			}
		};
		expect(() => installPlaybook(ports, { yaml: 'yaml', replace: false, installed: [] })).toThrow(
			expect.objectContaining({ code: 'INVALID' })
		);
		expect(ports.installer.install).not.toHaveBeenCalled();
	});

	it('reports a future schema before generic validation', () => {
		const ports = {
			installer: {
				parse: vi.fn(() => ({ ...valid, schemaVersion: 2 })),
				install: vi.fn(),
				countCustom: vi.fn()
			}
		};
		expect(() => installPlaybook(ports, { yaml: 'yaml', replace: false, installed: [] })).toThrow(
			expect.objectContaining({ code: 'FUTURE_SCHEMA' })
		);
	});

	it('returns structural and semantic reasons without writing', () => {
		const install = vi.fn();
		const structuralPorts = {
			installer: { parse: vi.fn(() => ({})), install, countCustom: vi.fn() }
		};
		expect(() =>
			installPlaybook(structuralPorts, { yaml: 'yaml', replace: false, installed: [] })
		).toThrow(
			expect.objectContaining({
				code: 'INVALID',
				reasons: expect.arrayContaining([expect.stringContaining('schemaVersion')])
			})
		);
		expect(install).not.toHaveBeenCalled();

		const semanticPorts = {
			installer: {
				parse: vi.fn(() => ({
					...valid,
					actions: [{ key: 'check', label: 'Check', dependsOn: ['missing'] }]
				})),
				install,
				countCustom: vi.fn()
			}
		};
		expect(() =>
			installPlaybook(semanticPorts, { yaml: 'yaml', replace: false, installed: [] })
		).toThrow(
			expect.objectContaining({
				code: 'INVALID',
				reasons: ['actions[key=check].dependsOn: references unknown action "missing"']
			})
		);
	});

	it('rejects bundled ids and returns both versions before replacement', () => {
		const ports = {
			installer: { parse: vi.fn(() => valid), install: vi.fn(), countCustom: vi.fn() }
		};
		expect(() =>
			installPlaybook(ports, {
				yaml: 'yaml',
				replace: false,
				installed: [
					{ id: valid.id, version: '1.0.0', source: 'bundled', filePath: '/bundled/test.yaml' }
				]
			})
		).toThrow(expect.objectContaining({ code: 'BUNDLED' }));
		expect(() =>
			installPlaybook(ports, {
				yaml: 'yaml',
				replace: false,
				installed: [
					{ id: valid.id, version: '0.9.0', source: 'custom', filePath: '/custom/test.yaml' }
				]
			})
		).toThrow(
			expect.objectContaining({
				code: 'INSTALLED',
				existingVersion: '0.9.0',
				submittedVersion: '1.0.0'
			})
		);
	});
});
