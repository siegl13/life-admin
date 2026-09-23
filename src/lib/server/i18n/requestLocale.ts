import { AsyncLocalStorage } from 'node:async_hooks';
import type { Locale } from '$lib/i18n';

/**
 * Node's request-handling event loop can interleave two concurrent
 * requests' async work, so the effective locale cannot live in a plain
 * mutable module variable without risking one request reading another's
 * value mid-render. `AsyncLocalStorage` scopes it per async call chain
 * instead, isolating concurrent requests correctly with no new dependency.
 */
const storage = new AsyncLocalStorage<Locale>();

export function runWithLocale<T>(locale: Locale, fn: () => T): T {
	return storage.run(locale, fn);
}

export function getRequestLocale(): Locale | undefined {
	return storage.getStore();
}
