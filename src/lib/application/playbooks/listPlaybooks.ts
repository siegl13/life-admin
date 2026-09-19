import type { NormalizedPlaybook } from '../../domain/playbook/normalize';
import type { PlaybookCatalogPort } from '../ports';

/** The playbooks a "new item" form may offer the user to build from. */
export function listPlaybooks(ports: { playbooks: PlaybookCatalogPort }): NormalizedPlaybook[] {
	return ports.playbooks.list();
}
