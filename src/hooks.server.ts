import { error, redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { authenticateSession } from '$lib/application/auth/authenticateSession';
import {
	accountsPort,
	appSettingsPort,
	clock,
	inboxPort,
	passwordHasherPort,
	sessionsPort
} from '$lib/server/appPorts';
import { getThemePreference } from '$lib/application/settings/theme';
import { SESSION_COOKIE } from '$lib/server/auth/cookies';
import { hashSessionToken } from '$lib/server/auth/sessionToken';
import { isPublicRoute } from '$lib/server/auth/routeAccess';
import { safeRedirectTarget } from '$lib/server/auth/redirectTarget';
import { getDb } from '$lib/server/db/database';
import { log } from '$lib/server/log';
import { config } from '$lib/server/config';
import { getRestorePending } from '$lib/server/restoreState';
import {
	cleanOrphanedAttachmentFiles,
	cleanStalePartFiles
} from '$lib/server/files/attachmentStorage';
import { cleanOrphanedInboxFiles, cleanStaleInboxPartFiles } from '$lib/server/files/inboxStorage';
import fs from 'node:fs';
import { startNotificationScheduler } from '$lib/server/notify/scheduler';

startNotificationScheduler();

export function addViewerObjectSource(csp: string): string {
	return /(?:^|;)\s*object-src\s/.test(csp) ? csp : `${csp}; object-src 'self'`;
}

export async function init(): Promise<void> {
	fs.rmSync(config.restoreStagingDir, { recursive: true, force: true });
	cleanStalePartFiles();
	cleanStaleInboxPartFiles();
	inboxPort.recoverInterruptedRouting(clock.nowIso());
	const db = getDb();
	cleanOrphanedAttachmentFiles(
		new Set(
			(db.prepare('SELECT storage_key FROM attachments').all() as { storage_key: string }[]).map(
				(row) => row.storage_key
			)
		)
	);
	cleanOrphanedInboxFiles(
		new Set(
			(
				db.prepare('SELECT storage_key FROM inbox_documents').all() as { storage_key: string }[]
			).map((row) => row.storage_key)
		)
	);
	sessionsPort.removeExpired(clock.nowIso());
	const resetPassword = process.env.LIFEADMIN_RESET_OWNER_PASSWORD;
	if (resetPassword) {
		const owner = getDb().prepare("SELECT id FROM users WHERE role = 'OWNER'").get() as
			{ id: string } | undefined;
		if (owner) {
			accountsPort.updatePasswordHash(
				owner.id,
				await passwordHasherPort.hash(resetPassword),
				clock.nowIso()
			);
			accountsPort.clearFailedLogins(owner.id, clock.nowIso());
			sessionsPort.removeAllForUser(owner.id);
		}
		log.warn('owner password reset applied; remove LIFEADMIN_RESET_OWNER_PASSWORD');
	}
	if (!process.env.ORIGIN?.toLowerCase().startsWith('https://')) {
		log.warn('session cookie is used over plain HTTP');
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	const restore = getRestorePending();
	if (restore && event.route.id !== '/healthz') {
		return new Response(
			`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Neustart erforderlich</title></head><body><main><h1>Neustart erforderlich</h1><p>Die Wiederherstellung ist abgeschlossen.</p><p>Sicherheitskopie: ${restore.safetyBackup}</p><code>docker compose restart lifeadmin</code></main></body></html>`,
			{
				status: 503,
				headers: {
					'content-type': 'text/html; charset=utf-8',
					'cache-control': 'no-store',
					'X-Content-Type-Options': 'nosniff',
					'Referrer-Policy': 'same-origin',
					'X-Frame-Options': 'DENY',
					// This page needs no script, style, image or form of its own,
					// so it gets the most restrictive policy possible rather than
					// mirroring svelte.config.js's kit.csp (which allows 'self'
					// scripts/styles for the app's normal pages).
					'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
					...(event.url.protocol === 'https:'
						? { 'Strict-Transport-Security': 'max-age=15552000; includeSubDomains' }
						: {})
				}
			}
		);
	}
	if (restore) {
		// Only /healthz reaches this point while a restore is pending (every
		// other route already returned the static page above). The database
		// is deliberately closed, so no auth/owner lookup may run: /healthz's
		// own isRestorePending() check reports the degraded status without
		// ever needing locals.user.
		event.locals.user = null;
	} else {
		const rawToken = event.cookies.get(SESSION_COOKIE);
		event.locals.user = rawToken
			? authenticateSession(
					{ accounts: accountsPort, sessions: sessionsPort, clock },
					hashSessionToken(rawToken)
				)
			: null;

		const ownerExists = accountsPort.ownerExists();
		const routeId = event.route.id;
		if (routeId && !isPublicRoute(routeId, ownerExists) && !event.locals.user) {
			if (event.request.method !== 'GET') error(403, 'Forbidden');
			if (!ownerExists) redirect(303, '/setup');
			const target = safeRedirectTarget(`${event.url.pathname}${event.url.search}`);
			redirect(303, `/login?redirectTo=${encodeURIComponent(target)}`);
		}
	}

	// Static assets are served before this hook by Vite or adapter-node.
	// Same DB-closed constraint as above: only read while a restore isn't
	// pending, or /healthz would hit the closed database too.
	const theme = restore ? 'system' : getThemePreference({ settings: appSettingsPort });
	const response = await resolve(event, {
		transformPageChunk: ({ html }) =>
			theme === 'system'
				? html
				: html.replace('<html lang="de">', `<html lang="de" data-theme="${theme}">`)
	});
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	const inlinePdfContent =
		event.route.id === '/items/[id]/attachments/[attachmentId]/content' &&
		response.headers.get('content-type') === 'application/pdf' &&
		response.headers.get('content-disposition')?.startsWith('inline;');
	response.headers.set('X-Frame-Options', inlinePdfContent ? 'SAMEORIGIN' : 'DENY');
	if (
		event.route.id === '/items/[id]/attachments/[attachmentId]' &&
		response.headers.get('content-type')?.includes('text/html')
	) {
		const csp = response.headers.get('content-security-policy');
		if (csp) response.headers.set('content-security-policy', addViewerObjectSource(csp));
	}
	if (event.url.protocol === 'https:') {
		response.headers.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
	}
	if (
		event.locals.user &&
		(response.headers.get('content-type')?.includes('text/html') ||
			event.url.pathname.endsWith('__data.json'))
	) {
		response.headers.set('Cache-Control', 'no-store');
	}
	return response;
};

export const handleError: HandleServerError = ({ error: cause, event }) => {
	const errorId = randomUUID();
	log.error('request failed', {
		errorId,
		routeId: event.route.id,
		method: event.request.method,
		reason: cause instanceof Error ? cause.stack : String(cause)
	});
	return { message: 'Ein Fehler ist aufgetreten.', errorId };
};
