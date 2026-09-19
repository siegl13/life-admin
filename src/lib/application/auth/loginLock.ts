/**
 * Serializes the login decision (read lockout state, verify, persist
 * failure/success) for the same normalized username, so parallel requests
 * for one account cannot race around the persisted lockout: only one
 * request at a time actually executes the critical section for a given
 * username, and the next one in line always sees the previous one's
 * already-persisted result.
 *
 * A plain in-memory Map keyed by normalized username, holding the tail of a
 * promise chain per key. Entries are removed once their chain is empty
 * again, so this never grows without bound across the life of the process
 * (only usernames with an in-flight request occupy an entry at all).
 */
const tails = new Map<string, Promise<void>>();

export function normalizeUsernameForLock(username: string): string {
	return username.trim().toLowerCase();
}

export function runExclusiveForUsername<T>(username: string, fn: () => Promise<T>): Promise<T> {
	const key = normalizeUsernameForLock(username);
	const previousTail = tails.get(key) ?? Promise.resolve();
	const result = previousTail.then(fn, fn);
	// Never rejects, so a failed attempt does not break the chain for the
	// next queued caller on the same username.
	const tail = result.then(
		() => undefined,
		() => undefined
	);
	tails.set(key, tail);
	void tail.finally(() => {
		if (tails.get(key) === tail) tails.delete(key);
	});
	return result;
}
