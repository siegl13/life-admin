import { describe, expect, it } from 'vitest';
import { checkPassword } from './password';
import { isLocked, nextLockout } from './lockout';
import { checkSession, needsTouch } from './session';

describe('authentication policy', () => {
	it('validates passwords without infrastructure', () => {
		expect(checkPassword('short', 'owner')).toBe('TOO_SHORT');
		expect(checkPassword('ownerownerowner', 'OWNEROWNEROWNER')).toBe('SAME_AS_USERNAME');
		expect(checkPassword('correct horse battery staple', 'owner')).toBeNull();
	});

	it('locks the fifth failed login and caps the delay', () => {
		const now = '2026-09-08T08:00:00.000Z';
		expect(nextLockout(3, now).lockedUntil).toBeNull();
		expect(isLocked(nextLockout(4, now).lockedUntil, now)).toBe(true);
		expect(nextLockout(20, now).lockedUntil).toBe('2026-09-08T08:15:00.000Z');
	});

	it('enforces absolute and idle session expiry and touch interval', () => {
		expect(
			checkSession(
				{
					createdAt: '2026-01-01T00:00:00Z',
					lastSeenAt: '2026-01-02T00:00:00Z',
					expiresAt: '2026-01-03T00:00:00Z'
				},
				'2026-01-03T00:00:00Z'
			)
		).toBe('EXPIRED_ABSOLUTE');
		expect(needsTouch('2026-01-01T00:00:00Z', '2026-01-01T01:01:00Z')).toBe(true);
	});
});
