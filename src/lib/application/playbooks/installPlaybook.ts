import { normalizePlaybook, type NormalizedPlaybook } from '$lib/domain/playbook/normalize';
import { parsePlaybookStructure } from '$lib/domain/playbook/schema';
import { validatePlaybookSemantics } from '$lib/domain/playbook/semanticValidation';
import { hasValidPlaybookFilename, MAX_PLAYBOOK_BYTES } from '$lib/domain/playbook/limits';

export const MAX_CUSTOM_PLAYBOOKS = 100;

export class PlaybookInstallError extends Error {
	constructor(
		public readonly code:
			'INVALID' | 'TOO_LARGE' | 'BUNDLED' | 'INSTALLED' | 'TOO_MANY' | 'FUTURE_SCHEMA',
		public readonly reasons: readonly string[] = [],
		public readonly existingVersion: string | null = null,
		public readonly submittedVersion: string | null = null
	) {
		super(code);
	}
}

export interface InstalledPlaybook {
	id: string;
	version: string;
	source: 'bundled' | 'custom';
	filePath: string;
}

export interface PlaybookInstallPort {
	parse(yaml: string): unknown;
	install(input: {
		playbookId: string;
		yaml: string;
		replace: boolean;
		provenCustomPath: string | null;
	}): string;
	countCustom(): number;
}

export function installPlaybook(
	ports: { installer: PlaybookInstallPort },
	input: { yaml: string; replace: boolean; installed: readonly InstalledPlaybook[] }
): NormalizedPlaybook {
	if (Buffer.byteLength(input.yaml, 'utf8') > MAX_PLAYBOOK_BYTES)
		throw new PlaybookInstallError('TOO_LARGE');
	let raw: unknown;
	try {
		raw = ports.installer.parse(input.yaml);
	} catch (error) {
		throw new PlaybookInstallError('INVALID', [
			error instanceof Error ? error.message : 'YAML_PARSE_ERROR'
		]);
	}
	if (
		typeof raw === 'object' &&
		raw !== null &&
		Object.prototype.hasOwnProperty.call(raw, 'schemaVersion') &&
		(raw as { schemaVersion?: unknown }).schemaVersion !== 1
	) {
		throw new PlaybookInstallError('FUTURE_SCHEMA');
	}
	const structural = parsePlaybookStructure(raw);
	if (!structural.success) {
		throw new PlaybookInstallError(
			'INVALID',
			structural.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
		);
	}
	const semanticIssues = validatePlaybookSemantics(structural.data);
	if (semanticIssues.length > 0) {
		throw new PlaybookInstallError(
			'INVALID',
			semanticIssues.map((issue) => `${issue.path}: ${issue.message}`)
		);
	}
	const playbook = normalizePlaybook(structural.data);
	if (!hasValidPlaybookFilename(playbook.id))
		throw new PlaybookInstallError('INVALID', ['id is too long for a playbook filename']);
	const existing = input.installed.find((entry) => entry.id === playbook.id);
	if (existing?.source === 'bundled') throw new PlaybookInstallError('BUNDLED');
	if (existing && !input.replace) {
		throw new PlaybookInstallError('INSTALLED', [], existing.version, playbook.version);
	}
	if (!existing && ports.installer.countCustom() >= MAX_CUSTOM_PLAYBOOKS) {
		throw new PlaybookInstallError('TOO_MANY');
	}
	ports.installer.install({
		playbookId: playbook.id,
		yaml: input.yaml,
		replace: existing !== undefined && input.replace,
		provenCustomPath: existing?.source === 'custom' ? existing.filePath : null
	});
	return playbook;
}
