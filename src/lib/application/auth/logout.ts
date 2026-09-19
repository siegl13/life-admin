import type { SessionPort } from '../ports';

export function logout(sessions: SessionPort, tokenHash: string | null): void {
	if (tokenHash) sessions.remove(tokenHash);
}
