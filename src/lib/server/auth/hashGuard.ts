/**
 * A small, deliberately bounded process-wide guard around expensive
 * password-hash operations (scrypt hash/verify). This is NOT a generic
 * rate-limiter framework and never will be: it exists only to stop an
 * attacker who submits many unknown usernames (each still requiring a
 * dummy-hash verification to avoid a user-enumeration timing oracle, see
 * login.ts) from burning unbounded CPU on a Pi. A future multi-instance
 * deployment can replace this boundary with something that spans processes;
 * V1 is a single process, so in-memory state is enough.
 *
 * Two independent bounds, both fixed constants (never a user setting):
 * - at most MAX_CONCURRENT scrypt operations in flight at once
 * - at most MAX_PER_MINUTE operations starting within a trailing 60s window
 *
 * When either bound is hit, the operation is refused before scrypt ever
 * runs. The caller (login.ts) turns that refusal into the exact same
 * generic failure a wrong password produces, so it reveals nothing about
 * whether the attempted username exists.
 */

const MAX_CONCURRENT = 2;
const MAX_PER_MINUTE = 10;
const WINDOW_MS = 60_000;

export class HashGuardExhaustedError extends Error {}

let active = 0;
const recentStarts: number[] = [];

function pruneOldStarts(now: number): void {
	while (recentStarts.length > 0 && now - recentStarts[0] > WINDOW_MS) {
		recentStarts.shift();
	}
}

export async function withHashGuard<T>(fn: () => Promise<T>): Promise<T> {
	const now = Date.now();
	pruneOldStarts(now);
	if (active >= MAX_CONCURRENT || recentStarts.length >= MAX_PER_MINUTE) {
		throw new HashGuardExhaustedError('hash guard exhausted');
	}
	active += 1;
	recentStarts.push(now);
	try {
		return await fn();
	} finally {
		active -= 1;
	}
}
