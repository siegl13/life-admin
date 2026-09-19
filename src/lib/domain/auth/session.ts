export const ABSOLUTE_LIFETIME_DAYS = 30;
export const IDLE_LIFETIME_DAYS = 7;
export const TOUCH_INTERVAL_MINUTES = 60;

export type SessionVerdict = 'VALID' | 'EXPIRED_ABSOLUTE' | 'EXPIRED_IDLE';

export function checkSession(
	input: { createdAt: string; lastSeenAt: string; expiresAt: string },
	nowIso: string
): SessionVerdict {
	const now = Date.parse(nowIso);
	if (now >= Date.parse(input.expiresAt)) return 'EXPIRED_ABSOLUTE';
	if (now - Date.parse(input.lastSeenAt) >= IDLE_LIFETIME_DAYS * 86_400_000) return 'EXPIRED_IDLE';
	return 'VALID';
}

export function needsTouch(lastSeenAt: string, nowIso: string): boolean {
	return Date.parse(nowIso) - Date.parse(lastSeenAt) >= TOUCH_INTERVAL_MINUTES * 60_000;
}
