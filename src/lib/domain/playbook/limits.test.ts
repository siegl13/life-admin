import { describe, expect, it } from 'vitest';
import { hasValidPlaybookFilename } from './limits';

describe('hasValidPlaybookFilename', () => {
	it('includes the YAML extension in the UTF-8 filesystem limit', () => {
		expect(hasValidPlaybookFilename('a'.repeat(250))).toBe(true);
		expect(hasValidPlaybookFilename('a'.repeat(251))).toBe(false);
	});
});
