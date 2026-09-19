import { describe, expect, it, vi } from 'vitest';
import { CannotUninstallBundledPlaybookError, uninstallPlaybook } from './uninstallPlaybook';

describe('uninstallPlaybook', () => {
	it('removes a custom playbook and ignores a missing id', () => {
		const uninstall = vi.fn();
		const ports = { installer: { install: vi.fn(), uninstall } };
		uninstallPlaybook(ports, {
			playbookId: 'de.test.custom',
			installed: [
				{
					id: 'de.test.custom',
					version: '1.0.0',
					source: 'custom',
					filePath: '/custom/de.test.custom.yaml'
				}
			]
		});
		expect(uninstall).toHaveBeenCalledWith('de.test.custom', '/custom/de.test.custom.yaml');
		uninstallPlaybook(ports, { playbookId: 'missing', installed: [] });
		expect(uninstall).toHaveBeenLastCalledWith('missing', null);
	});

	it('refuses to uninstall a bundled playbook', () => {
		const ports = { installer: { install: vi.fn(), uninstall: vi.fn() } };
		expect(() =>
			uninstallPlaybook(ports, {
				playbookId: 'de.test.bundled',
				installed: [
					{
						id: 'de.test.bundled',
						version: '1.0.0',
						source: 'bundled',
						filePath: '/bundled/test.yaml'
					}
				]
			})
		).toThrow(CannotUninstallBundledPlaybookError);
	});
});
