/** Shared input cap for every playbook source. */
export const MAX_PLAYBOOK_BYTES = 128 * 1024;
export const MAX_PLAYBOOK_FILENAME_BYTES = 255;

export function hasValidPlaybookFilename(playbookId: string): boolean {
	return Buffer.byteLength(`${playbookId}.yaml`, 'utf8') <= MAX_PLAYBOOK_FILENAME_BYTES;
}
