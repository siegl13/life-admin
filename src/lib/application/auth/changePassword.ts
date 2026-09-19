import { checkPassword } from '$lib/domain/auth/password';
import { ABSOLUTE_LIFETIME_DAYS } from '$lib/domain/auth/session';
import type {
	Clock,
	OwnerAccountPort,
	PasswordHasherPort,
	SessionPort,
	TokenGeneratorPort
} from '../ports';
import { InvalidPasswordError, PasswordMismatchError } from './createOwner';
import { InvalidCredentialsError } from './login';

export async function changePassword(
	ports: {
		accounts: OwnerAccountPort;
		sessions: SessionPort;
		tokens: TokenGeneratorPort;
		hasher: PasswordHasherPort;
		clock: Clock;
	},
	input: { userId: string; current: string; password: string; confirmation: string }
): Promise<{ token: string }> {
	const user = ports.accounts.findById(input.userId);
	if (!user || !(await ports.hasher.verify(input.current, user.passwordHash))) {
		throw new InvalidCredentialsError();
	}
	if (input.password !== input.confirmation) throw new PasswordMismatchError();
	if (checkPassword(input.password, user.username)) throw new InvalidPasswordError();
	const nowIso = ports.clock.nowIso();
	ports.accounts.updatePasswordHash(user.id, await ports.hasher.hash(input.password), nowIso);
	ports.sessions.removeAllForUser(user.id);
	const { token, tokenHash } = ports.tokens.newSessionToken();
	ports.sessions.create({
		tokenHash,
		userId: user.id,
		createdAt: nowIso,
		lastSeenAt: nowIso,
		expiresAt: new Date(Date.parse(nowIso) + ABSOLUTE_LIFETIME_DAYS * 86_400_000).toISOString()
	});
	return { token };
}
