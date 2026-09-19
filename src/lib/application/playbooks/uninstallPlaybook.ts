import type { InstalledPlaybook, PlaybookInstallPort } from './installPlaybook';

export class CannotUninstallBundledPlaybookError extends Error {}

export function uninstallPlaybook(
	ports: {
		installer: Pick<PlaybookInstallPort, 'install'> & {
			uninstall(playbookId: string, provenCustomPath: string | null): void;
		};
	},
	input: { playbookId: string; installed: readonly InstalledPlaybook[] }
): void {
	const existing = input.installed.find((entry) => entry.id === input.playbookId);
	if (existing?.source === 'bundled') throw new CannotUninstallBundledPlaybookError();
	ports.installer.uninstall(
		input.playbookId,
		existing?.source === 'custom' ? existing.filePath : null
	);
}
