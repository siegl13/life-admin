import { isLocked } from '$lib/domain/auth/lockout';
import { ABSOLUTE_LIFETIME_DAYS } from '$lib/domain/auth/session';
import type {
	Clock,
	OwnerAccountPort,
	PasswordHasherPort,
	SessionPort,
	TokenGeneratorPort
} from '../ports';
import { runExclusiveForUsername } from './loginLock';

export class InvalidCredentialsError extends Error {}
export class AccountLockedError extends Error {
	constructor(readonly minutes: number) {
		super('Account locked');
	}
}

// Valid encoded value, deliberately not the hash of any useful password.
const DUMMY_HASH =
	'scrypt$N=65536,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

type LoginPorts = {
	accounts: OwnerAccountPort;
	sessions: SessionPort;
	tokens: TokenGeneratorPort;
	hasher: PasswordHasherPort;
	clock: Clock;
};

/**
 * The login decision (read lockout state, verify, persist failure/success)
 * is serialized per normalized username via runExclusiveForUsername, so
 * parallel requests for the same account cannot race around the persisted
 * lockout: only one at a time actually executes this critical section for
 * a given username, and failure-count persistence is additionally atomic
 * at the repository level (authRepository.recordFailedLogin), so the
 * invariant holds even if a future deployment removes this in-process lock.
 */
export async function login(
	ports: LoginPorts,
	input: { username: string; password: string }
): Promise<{ user: { id: string; username: string }; token: string }> {
	return runExclusiveForUsername(input.username, () => attemptLogin(ports, input));
}

async function attemptLogin(
	ports: LoginPorts,
	input: { username: string; password: string }
): Promise<{ user: { id: string; username: string }; token: string }> {
	const nowIso = ports.clock.nowIso();
	const user = ports.accounts.findByUsername(input.username.trim());
	if (user && isLocked(user.lockedUntil, nowIso)) {
		throw new AccountLockedError(
			Math.max(1, Math.ceil((Date.parse(user.lockedUntil!) - Date.parse(nowIso)) / 60_000))
		);
	}
	const valid = await ports.hasher.verify(input.password, user?.passwordHash ?? DUMMY_HASH);
	if (!user || !valid) {
		if (user) ports.accounts.recordFailedLogin(user.id, nowIso);
		throw new InvalidCredentialsError();
	}
	ports.accounts.clearFailedLogins(user.id, nowIso);
	if (ports.hasher.needsRehash(user.passwordHash)) {
		ports.accounts.updatePasswordHash(user.id, await ports.hasher.hash(input.password), nowIso);
	}
	const { token, tokenHash } = ports.tokens.newSessionToken();
	ports.sessions.create({
		tokenHash,
		userId: user.id,
		createdAt: nowIso,
		lastSeenAt: nowIso,
		expiresAt: new Date(Date.parse(nowIso) + ABSOLUTE_LIFETIME_DAYS * 86_400_000).toISOString()
	});
	return { user: { id: user.id, username: user.username }, token };
}
