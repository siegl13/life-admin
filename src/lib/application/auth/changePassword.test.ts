import { describe, expect, it, vi } from 'vitest';
import type { AccountUser, OwnerAccountPort, PasswordHasherPort, SessionPort } from '../ports';
import { InvalidPasswordError, PasswordMismatchError } from './createOwner';
import { InvalidCredentialsError } from './login';
import { changePassword } from './changePassword';

const NOW = '2026-01-01T00:00:00.000Z';
const OLD_HASH = 'stored-hash-for-old-password';

function createFakeAccounts(initial: AccountUser) {
	let user: AccountUser = { ...initial };
	const port: OwnerAccountPort = {
		ownerExists: () => true,
		findByUsername: (username) =>
			username.trim().toLowerCase() === user.username.toLowerCase() ? { ...user } : null,
		findById: (id) => (id === user.id ? { ...user } : null),
		createOwner: () => {
			throw new Error('not used in this test');
		},
		updatePasswordHash: (id, passwordHash) => {
			if (id === user.id) user = { ...user, passwordHash };
		},
		recordFailedLogin: () => {},
		clearFailedLogins: () => {}
	};
	return { port, getUser: () => user };
}

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

let tokenCounter = 0;
function createFakeTokens() {
	return {
		newSessionToken: () => {
			tokenCounter++;
			return { token: `token-${tokenCounter}`, tokenHash: `hash-${tokenCounter}` };
		}
	};
}

function createFakeHasher(): PasswordHasherPort {
	return {
		async hash(plain) {
			return `stored-hash-for-${plain}`;
		},
		async verify(plain, stored) {
			return stored === OLD_HASH && plain === 'the-old-password';
		},
		needsRehash: () => false
	};
}

const clock = { nowIso: () => NOW, todayIso: () => '2026-01-01', localHour: () => 12 };

describe('changePassword (Finding 10-E)', () => {
	it('rejects an incorrect current password and changes nothing', async () => {
		const accounts = createFakeAccounts({
			id: 'owner-1',
			username: 'owner',
			passwordHash: OLD_HASH,
			role: 'OWNER',
			failedLoginCount: 0,
			lockedUntil: null
		});
		const ports = {
			accounts: accounts.port,
			sessions: createFakeSessions(),
			tokens: createFakeTokens(),
			hasher: createFakeHasher(),
			clock
		};

		await expect(
			changePassword(ports, {
				userId: 'owner-1',
				current: 'wrong-current-password',
				password: 'a-brand-new-password-1',
				confirmation: 'a-brand-new-password-1'
			})
		).rejects.toThrow(InvalidCredentialsError);
		expect(accounts.getUser().passwordHash).toBe(OLD_HASH);
	});

	it('rejects a new password that does not match its confirmation', async () => {
		const accounts = createFakeAccounts({
			id: 'owner-1',
			username: 'owner',
			passwordHash: OLD_HASH,
			role: 'OWNER',
			failedLoginCount: 0,
			lockedUntil: null
		});
		const ports = {
			accounts: accounts.port,
			sessions: createFakeSessions(),
			tokens: createFakeTokens(),
			hasher: createFakeHasher(),
			clock
		};

		await expect(
			changePassword(ports, {
				userId: 'owner-1',
				current: 'the-old-password',
				password: 'a-brand-new-password-1',
				confirmation: 'a-different-password-2'
			})
		).rejects.toThrow(PasswordMismatchError);
	});

	it('rejects a new password that fails the domain password policy', async () => {
		const accounts = createFakeAccounts({
			id: 'owner-1',
			username: 'owner',
			passwordHash: OLD_HASH,
			role: 'OWNER',
			failedLoginCount: 0,
			lockedUntil: null
		});
		const ports = {
			accounts: accounts.port,
			sessions: createFakeSessions(),
			tokens: createFakeTokens(),
			hasher: createFakeHasher(),
			clock
		};

		await expect(
			changePassword(ports, {
				userId: 'owner-1',
				current: 'the-old-password',
				password: 'owner',
				confirmation: 'owner'
			})
		).rejects.toThrow(InvalidPasswordError);
	});

	it('on success: invalidates every previous session and issues exactly one fresh current-browser session', async () => {
		const accounts = createFakeAccounts({
			id: 'owner-1',
			username: 'owner',
			passwordHash: OLD_HASH,
			role: 'OWNER',
			failedLoginCount: 0,
			lockedUntil: null
		});
		const sessions = createFakeSessions();
		// Two prior sessions, as if the Owner were logged in on two browsers.
		sessions.create({
			tokenHash: 'hash-browser-1',
			userId: 'owner-1',
			createdAt: NOW,
			lastSeenAt: NOW,
			expiresAt: '2027-01-01T00:00:00.000Z'
		});
		sessions.create({
			tokenHash: 'hash-browser-2',
			userId: 'owner-1',
			createdAt: NOW,
			lastSeenAt: NOW,
			expiresAt: '2027-01-01T00:00:00.000Z'
		});
		const createSpy = vi.spyOn(sessions, 'create');
		const ports = {
			accounts: accounts.port,
			sessions,
			tokens: createFakeTokens(),
			hasher: createFakeHasher(),
			clock
		};

		const result = await changePassword(ports, {
			userId: 'owner-1',
			current: 'the-old-password',
			password: 'a-brand-new-password-1',
			confirmation: 'a-brand-new-password-1'
		});

		// The stored hash is the new password's, never the plaintext.
		expect(accounts.getUser().passwordHash).toBe('stored-hash-for-a-brand-new-password-1');
		// Both prior browser sessions are gone.
		expect(sessions.find('hash-browser-1')).toBeNull();
		expect(sessions.find('hash-browser-2')).toBeNull();
		// Exactly one fresh session was created, for the current browser.
		expect(createSpy).toHaveBeenCalledTimes(1);
		expect(result.token).toBeTruthy();
	});
});
