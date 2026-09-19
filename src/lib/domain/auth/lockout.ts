export const MAX_FAILURES_BEFORE_LOCK = 5;
export const MAX_LOCK_MINUTES = 15;

export function isLocked(lockedUntil: string | null, nowIso: string): boolean {
	return lockedUntil !== null && Date.parse(lockedUntil) > Date.parse(nowIso);
}

export function nextLockout(
	previousFailureCount: number,
	nowIso: string
): { failureCount: number; lockedUntil: string | null } {
	const failureCount = previousFailureCount + 1;
	if (failureCount < MAX_FAILURES_BEFORE_LOCK) return { failureCount, lockedUntil: null };
	const minutes = Math.min(2 ** (failureCount - MAX_FAILURES_BEFORE_LOCK), MAX_LOCK_MINUTES);
	return {
		failureCount,
		lockedUntil: new Date(Date.parse(nowIso) + minutes * 60_000).toISOString()
	};
}
