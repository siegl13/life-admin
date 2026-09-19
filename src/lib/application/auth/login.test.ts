import { describe, expect, it, vi } from 'vitest';
import { nextLockout } from '$lib/domain/auth/lockout';
import type {
	AccountUser,
	OwnerAccountPort,
	PasswordHasherPort,
	SessionPort,
	TokenGeneratorPort
} from '../ports';
import { AccountLockedError, InvalidCredentialsError, login } from './login';

const NOW = '2026-01-01T00:00:00.000Z';
const CORRECT_HASH = 'stored-hash-for-the-real-password';

/** A small in-memory account store mimicking authRepository's real,
 *  now-atomic behaviour: recordFailedLogin re-reads the CURRENT count and
 *  derives the new count/lockout from it, never from a value a caller
 *  precomputed earlier. That is what makes concurrent calls safe here,
 *  the same guarantee the real repository's `.immediate()` transaction
 *  provides against genuinely concurrent database connections. */
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
		recordFailedLogin: (id, nowIso) => {
			if (id !== user.id) return;
			const { failureCount, lockedUntil } = nextLockout(user.failedLoginCount, nowIso);
			user = { ...user, failedLoginCount: failureCount, lockedUntil };
		},
		clearFailedLogins: (id) => {
			if (id === user.id) user = { ...user, failedLoginCount: 0, lockedUntil: null };
		}
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
const tokensPort: TokenGeneratorPort = {
	newSessionToken: () => {
		tokenCounter++;
		return { token: `token-${tokenCounter}`, tokenHash: `hash-${tokenCounter}` };
	}
};

const clock = { nowIso: () => NOW, todayIso: () => '2026-01-01', localHour: () => 12 };

/** A fake hasher whose `verify` resolves on the next microtask (via a
 *  zero-delay promise), so concurrent login() calls genuinely interleave
 *  around it the same way they would around a real async scrypt call. */
function createFakeHasher(correctPassword: string): PasswordHasherPort {
	return {
		async hash(plain) {
			await Promise.resolve();
			return `stored-hash-for-${plain}`;
		},
		async verify(plain, stored) {
			await Promise.resolve();
			return stored === CORRECT_HASH && plain === correctPassword;
		},
		needsRehash: () => false
	};
}

const OLD_ENCODING_HASH = 'old-scrypt-encoding-hash';

/** Same contract as createFakeHasher, but `verify` also accepts an
 *  old-format stored hash for the correct password, and `needsRehash` flags
 *  exactly that old format — mirroring a real scrypt parameter upgrade
 *  without needing real scrypt to prove login.ts's own upgrade logic. */
function createFakeHasherWithOldEncoding(correctPassword: string): PasswordHasherPort {
	return {
		async hash(plain) {
			await Promise.resolve();
			return `stored-hash-for-${plain}`;
		},
		async verify(plain, stored) {
			await Promise.resolve();
			return (stored === CORRECT_HASH || stored === OLD_ENCODING_HASH) && plain === correctPassword;
		},
		needsRehash: (stored) => stored === OLD_ENCODING_HASH
	};
}

describe('login / concurrency and lockout (Finding 3)', () => {
	it('10 parallel wrong-password requests for the same username cannot bypass the 5-failure lockout, and calls the hasher at most 5 times', async () => {
		const accounts = createFakeAccounts({
			id: 'owner-1',
			username: 'owner',
			passwordHash: CORRECT_HASH,
			role: 'OWNER',
			failedLoginCount: 0,
			lockedUntil: null
		});
		const hasher = createFakeHasher('the-real-password');
		const verifySpy = vi.spyOn(hasher, 'verify');
		const ports = {
			accounts: accounts.port,
			sessions: createFakeSessions(),
			tokens: tokensPort,
			hasher,
			clock
		};

		const attempts = Array.from({ length: 10 }, () =>
			login(ports, { username: 'owner', password: 'wrong-password' }).catch((e) => e)
		);
		const results = await Promise.all(attempts);

		expect(
			results.every((r) => r instanceof InvalidCredentialsError || r instanceof AccountLockedError)
		).toBe(true);
		expect(verifySpy).toHaveBeenCalledTimes(5);
		expect(accounts.getUser().failedLoginCount).toBe(5);
		expect(accounts.getUser().lockedUntil).not.toBeNull();
	});

	it('once locked, a login attempt calls the hasher zero times', async () => {
		const farFuture = '2026-01-01T00:15:00.000Z';
		const accounts = createFakeAccounts({
			id: 'owner-1',
			username: 'owner',
			passwordHash: CORRECT_HASH,
			role: 'OWNER',
			failedLoginCount: 5,
			lockedUntil: farFuture
		});
		const hasher = createFakeHasher('the-real-password');
		const verifySpy = vi.spyOn(hasher, 'verify');
		const ports = {
			accounts: accounts.port,
			sessions: createFakeSessions(),
			tokens: tokensPort,
			hasher,
			clock
		};

		await expect(
			login(ports, { username: 'owner', password: 'the-real-password' })
		).rejects.toThrow(AccountLockedError);
		expect(verifySpy).not.toHaveBeenCalled();
	});

	it('a correct login after the lock has expired clears the failure count and lockout', async () => {
		const past = '2025-12-31T00:00:00.000Z';
		const accounts = createFakeAccounts({
			id: 'owner-1',
			username: 'owner',
			passwordHash: CORRECT_HASH,
			role: 'OWNER',
			failedLoginCount: 5,
			lockedUntil: past
		});
		const hasher = createFakeHasher('the-real-password');
		const ports = {
			accounts: accounts.port,
			sessions: createFakeSessions(),
			tokens: tokensPort,
			hasher,
			clock
		};

		await login(ports, { username: 'owner', password: 'the-real-password' });

		expect(accounts.getUser().failedLoginCount).toBe(0);
		expect(accounts.getUser().lockedUntil).toBeNull();
	});

	it('known and unknown usernames produce the identical generic failure', async () => {
		const accounts = createFakeAccounts({
			id: 'owner-1',
			username: 'owner',
			passwordHash: CORRECT_HASH,
			role: 'OWNER',
			failedLoginCount: 0,
			lockedUntil: null
		});
		const hasher = createFakeHasher('the-real-password');
		const ports = {
			accounts: accounts.port,
			sessions: createFakeSessions(),
			tokens: tokensPort,
			hasher,
			clock
		};

		const knownWrong = await login(ports, { username: 'owner', password: 'wrong' }).catch((e) => e);
		const unknown = await login(ports, { username: 'nobody', password: 'wrong' }).catch((e) => e);

		expect(knownWrong).toBeInstanceOf(InvalidCredentialsError);
		expect(unknown).toBeInstanceOf(InvalidCredentialsError);
		expect((knownWrong as Error).message).toBe((unknown as Error).message);
	});

	it('still calls the hasher for an unknown username (no early-exit timing oracle)', async () => {
		const accounts = createFakeAccounts({
			id: 'owner-1',
			username: 'owner',
			passwordHash: CORRECT_HASH,
			role: 'OWNER',
			failedLoginCount: 0,
			lockedUntil: null
		});
		const hasher = createFakeHasher('the-real-password');
		const verifySpy = vi.spyOn(hasher, 'verify');
		const ports = {
			accounts: accounts.port,
			sessions: createFakeSessions(),
			tokens: tokensPort,
			hasher,
			clock
		};

		await login(ports, { username: 'nobody', password: 'wrong' }).catch(() => {});
		expect(verifySpy).toHaveBeenCalledTimes(1);
	});

	it('parallel requests for different unknown usernames do not interfere with each other or with the real account', async () => {
		const accounts = createFakeAccounts({
			id: 'owner-1',
			username: 'owner',
			passwordHash: CORRECT_HASH,
			role: 'OWNER',
			failedLoginCount: 0,
			lockedUntil: null
		});
		const hasher = createFakeHasher('the-real-password');
		const ports = {
			accounts: accounts.port,
			sessions: createFakeSessions(),
			tokens: tokensPort,
			hasher,
			clock
		};

		const attempts = Array.from({ length: 8 }, (_, i) =>
			login(ports, { username: `nobody-${i}`, password: 'irrelevant' }).catch((e) => e)
		);
		const results = await Promise.all(attempts);
		expect(results.every((r) => r instanceof InvalidCredentialsError)).toBe(true);
		// The real account was never touched by any of these.
		expect(accounts.getUser().failedLoginCount).toBe(0);
	});
});

describe('login / transparent hash upgrade (Finding 10-G)', () => {
	it('a successful login against an old scrypt encoding transparently rehashes it, and still succeeds', async () => {
		const accounts = createFakeAccounts({
			id: 'owner-1',
			username: 'owner',
			passwordHash: OLD_ENCODING_HASH,
			role: 'OWNER',
			failedLoginCount: 0,
			lockedUntil: null
		});
		const hasher = createFakeHasherWithOldEncoding('the-real-password');
		const hashSpy = vi.spyOn(hasher, 'hash');
		const ports = {
			accounts: accounts.port,
			sessions: createFakeSessions(),
			tokens: tokensPort,
			hasher,
			clock
		};

		const result = await login(ports, { username: 'owner', password: 'the-real-password' });

		expect(result.token).toBeTruthy();
		// The stored hash is now the current encoding, derived from the
		// plaintext password only through the hasher's own hash() — never
		// stored or logged as plaintext anywhere in login.ts itself.
		expect(hashSpy).toHaveBeenCalledWith('the-real-password');
		expect(accounts.getUser().passwordHash).toBe('stored-hash-for-the-real-password');
		expect(accounts.getUser().passwordHash).not.toBe(OLD_ENCODING_HASH);
	});

	it('does not rehash when the stored encoding is already current', async () => {
		const accounts = createFakeAccounts({
			id: 'owner-1',
			username: 'owner',
			passwordHash: CORRECT_HASH,
			role: 'OWNER',
			failedLoginCount: 0,
			lockedUntil: null
		});
		const hasher = createFakeHasherWithOldEncoding('the-real-password');
		const hashSpy = vi.spyOn(hasher, 'hash');
		const ports = {
			accounts: accounts.port,
			sessions: createFakeSessions(),
			tokens: tokensPort,
			hasher,
			clock
		};

		await login(ports, { username: 'owner', password: 'the-real-password' });

		expect(hashSpy).not.toHaveBeenCalled();
		expect(accounts.getUser().passwordHash).toBe(CORRECT_HASH);
	});
});
