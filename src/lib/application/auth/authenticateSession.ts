import { checkSession, needsTouch } from '$lib/domain/auth/session';
import type { Clock, OwnerAccountPort, SessionPort } from '../ports';

export function authenticateSession(
	ports: { accounts: OwnerAccountPort; sessions: SessionPort; clock: Clock },
	tokenHash: string
): { id: string; username: string; role: string } | null {
	const session = ports.sessions.find(tokenHash);
	if (!session) return null;
	const nowIso = ports.clock.nowIso();
	if (checkSession(session, nowIso) !== 'VALID') {
		ports.sessions.remove(tokenHash);
		return null;
	}
	const user = ports.accounts.findById(session.userId);
	if (!user) {
		ports.sessions.remove(tokenHash);
		return null;
	}
	if (needsTouch(session.lastSeenAt, nowIso)) ports.sessions.touch(tokenHash, nowIso);
	return { id: user.id, username: user.username, role: user.role };
}
