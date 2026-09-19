import { describe, expect, it } from 'vitest';
import type { SessionPort } from '../ports';
import { logout } from './logout';

const NOW = '2026-01-01T00:00:00.000Z';

function createFakeSessions(): SessionPort {
	const rows = new Map<string, { userId: string }>();
	return {
		create: (record) => {
			rows.set(record.tokenHash, { userId: record.userId });
		},
		find: (tokenHash) => {
			const row = rows.get(tokenHash);
			return row
				? {
						tokenHash,
						userId: row.userId,
						createdAt: NOW,
						lastSeenAt: NOW,
						expiresAt: '2027-01-01T00:00:00.000Z'
					}
				: null;
		},
		touch: () => {},
		remove: (tokenHash) => {
			rows.delete(tokenHash);
		},
		removeAllForUser: (userId) => {
			for (const [key, row] of rows) if (row.userId === userId) rows.delete(key);
		},
		removeExpired: () => 0
	};
}

describe('logout (Finding 10-D)', () => {
	it('removes the session so its token can no longer authenticate', () => {
		const sessions = createFakeSessions();
		sessions.create({
			tokenHash: 'hash-1',
			userId: 'owner-1',
			createdAt: NOW,
			lastSeenAt: NOW,
			expiresAt: '2027-01-01T00:00:00.000Z'
		});
		expect(sessions.find('hash-1')).not.toBeNull();

		logout(sessions, 'hash-1');

		expect(sessions.find('hash-1')).toBeNull();
	});

	it('is a no-op when there is no session cookie', () => {
		const sessions = createFakeSessions();
		expect(() => logout(sessions, null)).not.toThrow();
	});

	it('does not remove other sessions belonging to the same or a different user', () => {
		const sessions = createFakeSessions();
		sessions.create({
			tokenHash: 'hash-1',
			userId: 'owner-1',
			createdAt: NOW,
			lastSeenAt: NOW,
			expiresAt: '2027-01-01T00:00:00.000Z'
		});
		sessions.create({
			tokenHash: 'hash-2',
			userId: 'owner-1',
			createdAt: NOW,
			lastSeenAt: NOW,
			expiresAt: '2027-01-01T00:00:00.000Z'
		});

		logout(sessions, 'hash-1');

		expect(sessions.find('hash-1')).toBeNull();
		expect(sessions.find('hash-2')).not.toBeNull();
	});
});
