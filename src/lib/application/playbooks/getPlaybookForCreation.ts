import type { NormalizedPlaybook } from '../../domain/playbook/normalize';
import type { PlaybookCatalogPort } from '../ports';

/** Looks up one playbook by id, e.g. to preview its fields before creating an item from it. */
export function getPlaybookForCreation(
	ports: { playbooks: PlaybookCatalogPort },
	playbookId: string
): NormalizedPlaybook | null {
	return ports.playbooks.findById(playbookId);
}
