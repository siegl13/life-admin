import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let withHashGuard: (typeof import('./hashGuard'))['withHashGuard'];
let HashGuardExhaustedError: (typeof import('./hashGuard'))['HashGuardExhaustedError'];

beforeEach(async () => {
	vi.resetModules();
	({ withHashGuard, HashGuardExhaustedError } = await import('./hashGuard'));
});

afterEach(() => {
	vi.useRealTimers();
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe('withHashGuard', () => {
	it('allows up to the concurrency cap, and refuses a 3rd concurrent operation without running it', async () => {
		const gate1 = deferred<void>();
		const gate2 = deferred<void>();
		let thirdRan = false;

		const p1 = withHashGuard(async () => {
			await gate1.promise;
			return 'one';
		});
		const p2 = withHashGuard(async () => {
			await gate2.promise;
			return 'two';
		});
		// Both slots are now occupied (MAX_CONCURRENT = 2); a 3rd must be
		// refused before its function ever runs.
		await expect(
			withHashGuard(async () => {
				thirdRan = true;
				return 'three';
			})
		).rejects.toThrow(HashGuardExhaustedError);
		expect(thirdRan).toBe(false);

		gate1.resolve();
		gate2.resolve();
		expect(await p1).toBe('one');
		expect(await p2).toBe('two');

		// A slot freed up: a 4th call now succeeds.
		await expect(withHashGuard(async () => 'four')).resolves.toBe('four');
	});

	it('refuses an 11th operation within the same rolling minute, without running it', async () => {
		for (let i = 0; i < 10; i++) {
			await withHashGuard(async () => i);
		}
		let ranAnEleventh = false;
		await expect(
			withHashGuard(async () => {
				ranAnEleventh = true;
			})
		).rejects.toThrow(HashGuardExhaustedError);
		expect(ranAnEleventh).toBe(false);
	});

	it('allows further operations once the rolling window has passed', async () => {
		vi.useFakeTimers();
		for (let i = 0; i < 10; i++) {
			await withHashGuard(async () => i);
		}
		await expect(withHashGuard(async () => 'blocked')).rejects.toThrow(HashGuardExhaustedError);

		vi.advanceTimersByTime(61_000);
		await expect(withHashGuard(async () => 'allowed again')).resolves.toBe('allowed again');
	});

	it('releases its concurrency slot even when the guarded function throws', async () => {
		await expect(
			withHashGuard(async () => {
				throw new Error('boom');
			})
		).rejects.toThrow('boom');
		// If the slot were not released, both of these would exhaust the
		// concurrency cap (2) and the second would be refused.
		const gate = deferred<void>();
		const p1 = withHashGuard(async () => gate.promise);
		await expect(withHashGuard(async () => 'ok')).resolves.toBe('ok');
		gate.resolve();
		await p1;
	});
});
