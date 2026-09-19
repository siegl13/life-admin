import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect, type Handle } from '@sveltejs/kit';

let tmpDir: string;
let handle: Handle;
let init: (typeof import('./hooks.server'))['init'];
let addViewerObjectSource: (typeof import('./hooks.server'))['addViewerObjectSource'];
let getDb: (typeof import('$lib/server/db/database'))['getDb'];
let closeDb: (typeof import('$lib/server/db/database'))['closeDb'];
let latchRestorePending: (typeof import('$lib/server/restoreState'))['latchRestorePending'];

function fakeEvent(routeId: string, method = 'GET') {
	return {
		route: { id: routeId },
		url: new URL(`http://localhost${routeId}`),
		cookies: { get: () => undefined },
		request: { method },
		locals: {} as App.Locals
	} as unknown as Parameters<Handle>[0]['event'];
}

beforeEach(async () => {
	vi.resetModules();
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-hooks-'));
	vi.stubEnv('LIFEADMIN_DATA_DIR', tmpDir);
	({ getDb, closeDb } = await import('$lib/server/db/database'));
	({ latchRestorePending } = await import('$lib/server/restoreState'));
	({ handle, init, addViewerObjectSource } = await import('./hooks.server'));
});

describe('viewer CSP', () => {
	it('adds only the same-origin object source and preserves frame-ancestors', () => {
		const csp = addViewerObjectSource(
			"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
		);
		expect(csp).toBe(
			"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'self'"
		);
	});
});

afterEach(() => {
	closeDb();
	vi.unstubAllEnvs();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('handle / restore-pending', () => {
	it('lets /healthz reach its own handler without touching the (closed) database', async () => {
		latchRestorePending({ safetyBackup: 'pre-restore-x.zip' });
		const resolve = vi.fn(async () => new Response(JSON.stringify({ status: 'restore-pending' })));
		const event = fakeEvent('/healthz');

		const response = await handle({ event, resolve });

		expect(resolve).toHaveBeenCalledOnce();
		expect(event.locals.user).toBeNull();
		expect(await response.text()).toContain('restore-pending');
	});

	it('serves the static restart-required page, with security headers, for every other route', async () => {
		latchRestorePending({ safetyBackup: 'pre-restore-x.zip' });
		const resolve = vi.fn(async () => new Response('should not be reached'));
		const event = fakeEvent('/settings');

		const response = await handle({ event, resolve });

		expect(resolve).not.toHaveBeenCalled();
		expect(response.status).toBe(503);
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.get('Referrer-Policy')).toBe('same-origin');
		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
		expect(response.headers.get('Content-Security-Policy')).toBe(
			"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
		);
		const body = await response.text();
		expect(body).toContain('pre-restore-x.zip');
	});
});

describe('handle / anonymous access to a protected binary endpoint', () => {
	it('redirects an anonymous GET to /settings/backup to login without ever calling resolve (createBackup is never reached)', async () => {
		getDb()
			.prepare(
				`INSERT INTO users (id, username, password_hash, created_at, updated_at, password_changed_at)
				 VALUES ('owner-1', 'owner', 'hash', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
			)
			.run();
		const resolve = vi.fn(async () => new Response('should not be reached'));
		const event = fakeEvent('/settings/backup');

		let caught: unknown;
		try {
			await handle({ event, resolve });
		} catch (thrown) {
			caught = thrown;
		}

		expect(isRedirect(caught)).toBe(true);
		expect((caught as { status: number }).status).toBe(303);
		expect((caught as { location: string }).location).toMatch(/^\/login\?redirectTo=/);
		// The redirect happens in the hook, before SvelteKit ever routes to the
		// endpoint, so the handler that would call createBackup() is never
		// reached, and no backup body or Content-Disposition header exists.
		expect(resolve).not.toHaveBeenCalled();
	});

	it('rejects an anonymous relation mutation before the route action can run', async () => {
		const resolve = vi.fn(async () => new Response('should not be reached'));
		const event = fakeEvent('/items/[id]', 'POST');

		let caught: unknown;
		try {
			await handle({ event, resolve });
		} catch (thrown) {
			caught = thrown;
		}

		expect(isHttpError(caught)).toBe(true);
		expect((caught as { status: number }).status).toBe(403);
		expect(resolve).not.toHaveBeenCalled();
	});
});

describe('init / LIFEADMIN_RESET_OWNER_PASSWORD (Finding 10-F)', () => {
	it('resets the password, clears lockout state, invalidates existing sessions, and never logs the secret', async () => {
		getDb()
			.prepare(
				`INSERT INTO users
					(id, username, password_hash, failed_login_count, locked_until,
					 created_at, updated_at, password_changed_at)
				 VALUES
					('owner-1', 'owner', 'stale-hash', 5, '2099-01-01T00:00:00.000Z',
					 '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
			)
			.run();
		getDb()
			.prepare(
				`INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
				 VALUES ('old-session-hash', 'owner-1', '2026-01-01T00:00:00.000Z',
				         '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z')`
			)
			.run();

		const NEW_PASSWORD = 'CorrectHorseBatteryStaple1!';
		vi.stubEnv('LIFEADMIN_RESET_OWNER_PASSWORD', NEW_PASSWORD);
		const logSpies = [
			vi.spyOn(console, 'log').mockImplementation(() => {}),
			vi.spyOn(console, 'warn').mockImplementation(() => {}),
			vi.spyOn(console, 'error').mockImplementation(() => {})
		];

		await init();

		const { passwordHasher } = await import('$lib/server/auth/passwordHasher');
		const row = getDb()
			.prepare('SELECT password_hash, failed_login_count, locked_until FROM users WHERE id = ?')
			.get('owner-1') as
			| { password_hash: string; failed_login_count: number; locked_until: string | null }
			| undefined;
		expect(row).toBeDefined();
		expect(row!.password_hash).not.toBe('stale-hash');
		expect(await passwordHasher.verify(NEW_PASSWORD, row!.password_hash)).toBe(true);
		expect(row!.failed_login_count).toBe(0);
		expect(row!.locked_until).toBeNull();

		const remainingSessions = getDb()
			.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?')
			.get('owner-1') as { n: number };
		expect(remainingSessions.n).toBe(0);

		for (const spy of logSpies) {
			for (const call of spy.mock.calls) {
				expect(JSON.stringify(call)).not.toContain(NEW_PASSWORD);
			}
		}
	});
});
