import { describe, expect, it } from 'vitest';
import { catalogErrorsForPage } from '../../src/lib/server/playbooks/pageErrors';

describe('settings load', () => {
	it('does not expose absolute catalog paths to the page', () => {
		const errors = catalogErrorsForPage([
			{
				source: 'custom',
				filePath: '/var/lib/life-admin/playbooks/nested/broken.yaml',
				reason: 'failed to read /var/lib/life-admin/playbooks/nested/broken.yaml'
			}
		]);

		expect(errors).toEqual([
			{
				source: 'custom',
				filePath: 'broken.yaml',
				reason: 'failed to read <path>'
			}
		]);
		expect(JSON.stringify(errors)).not.toContain('/var/lib/life-admin');
	});
});
