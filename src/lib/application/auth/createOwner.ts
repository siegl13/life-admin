import { checkPassword } from '$lib/domain/auth/password';
import { ABSOLUTE_LIFETIME_DAYS } from '$lib/domain/auth/session';
import type {
	Clock,
	OwnerAccountPort,
	PasswordHasherPort,
	SessionPort,
	TokenGeneratorPort
} from '../ports';

export class OwnerAlreadyExistsError extends Error {}
export class InvalidPasswordError extends Error {}
export class PasswordMismatchError extends Error {}

export async function createOwner(
	ports: {
		accounts: OwnerAccountPort;
		sessions: SessionPort;
		tokens: TokenGeneratorPort;
		hasher: PasswordHasherPort;
		clock: Clock;
		newId(): string;
	},
	input: { username: string; password: string; confirmation: string }
): Promise<{ user: { id: string; username: string }; token: string }> {
	const username = input.username.trim();
	if (ports.accounts.ownerExists()) throw new OwnerAlreadyExistsError();
	if (input.password !== input.confirmation) throw new PasswordMismatchError();
	if (!username || checkPassword(input.password, username)) throw new InvalidPasswordError();
	const passwordHash = await ports.hasher.hash(input.password);
	const nowIso = ports.clock.nowIso();
	const user = ports.accounts.createOwner({ id: ports.newId(), username, passwordHash, nowIso });
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
