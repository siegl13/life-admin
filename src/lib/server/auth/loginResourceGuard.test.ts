import { describe, expect, it } from 'vitest';
import { login, InvalidCredentialsError } from '$lib/application/auth/login';
import type {
	AccountUser,
	OwnerAccountPort,
	SessionPort,
	TokenGeneratorPort
} from '$lib/application/ports';
import { passwordHasher } from './passwordHasher';
import { withHashGuard } from './hashGuard';

/**
 * Server-layer test (not application-layer): exercises `login()` with the
 * real scrypt hasher wrapped by the real process-wide guard, exactly the
 * way appPorts.ts wires `passwordHasherPort`. Lives under server/ rather
 * than application/ because application/ may not import from $lib/server/*
 * (the ESLint boundary is not test-exempt) — this is what proves the
 * guard actually applies to the login flow, not just to withHashGuard in
 * isolation (see hashGuard.test.ts for that).
 */
function guardedHasher() {
	return {
		...passwordHasher,
		async verify(plain: string, stored: string) {
			try {
				return await withHashGuard(() => passwordHasher.verify(plain, stored));
			} catch {
				return false;
			}
		}
	};
}

function fakeAccounts(user: AccountUser): OwnerAccountPort {
	return {
		ownerExists: () => true,
		findByUsername: (username) =>
			username.trim().toLowerCase() === user.username.toLowerCase() ? { ...user } : null,
		findById: (id) => (id === user.id ? { ...user } : null),
		createOwner: () => {
			throw new Error('not used');
		},
		updatePasswordHash: () => {},
		recordFailedLogin: () => {},
		clearFailedLogins: () => {}
	};
}

function fakeSessions(): SessionPort {
	return {
		create: () => {},
		find: () => null,
		touch: () => {},
		remove: () => {},
		removeAllForUser: () => {},
		removeExpired: () => 0
	};
}

const tokensPort: TokenGeneratorPort = {
	newSessionToken: () => ({ token: 'tok', tokenHash: 'hash' })
};
const clock = {
	nowIso: () => '2026-01-01T00:00:00.000Z',
	todayIso: () => '2026-01-01',
	localHour: () => 12
};

describe('login with the real process-wide hash guard', () => {
	it('many parallel unknown-username login attempts are bounded by the guard and still fail generically, never crashing or hanging', async () => {
		const ports = {
			accounts: fakeAccounts({
				id: 'owner-1',
				username: 'owner',
				passwordHash: await passwordHasher.hash('the-real-password'),
				role: 'OWNER',
				failedLoginCount: 0,
				lockedUntil: null
			}),
			sessions: fakeSessions(),
			tokens: tokensPort,
			hasher: guardedHasher(),
			clock
		};

		const attempts = Array.from({ length: 25 }, (_, i) =>
			login(ports, { username: `nobody-${i}`, password: 'irrelevant' }).catch((e) => e)
		);
		const results = await Promise.all(attempts);

		expect(results.every((r) => r instanceof InvalidCredentialsError)).toBe(true);
	});
});
