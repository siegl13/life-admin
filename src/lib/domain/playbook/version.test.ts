import { describe, expect, it } from 'vitest';
import { newerVersionAvailable } from './version';

describe('newerVersionAvailable', () => {
	it('compares strict semvers without treating malformed values as newer', () => {
		expect(newerVersionAvailable('1.0.0', '1.0.0')).toBe(false);
		expect(newerVersionAvailable('1.0.0', '1.0.1')).toBe(true);
		expect(newerVersionAvailable('1.0.0', '1.1.0')).toBe(true);
		expect(newerVersionAvailable('1.9.9', '2.0.0')).toBe(true);
		expect(newerVersionAvailable('2.0.0', '1.9.9')).toBe(false);
		expect(newerVersionAvailable('bad', '2.0.0')).toBe(false);
	});

	it('compares components above the safe integer boundary', () => {
		expect(newerVersionAvailable('1.9007199254740992.0', '1.9007199254740993.0')).toBe(true);
		expect(newerVersionAvailable('1.9007199254740993.0', '1.9007199254740992.0')).toBe(false);
	});
});
