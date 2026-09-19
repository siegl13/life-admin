import type { Cookies } from '@sveltejs/kit';
import { ABSOLUTE_LIFETIME_DAYS } from '$lib/domain/auth/session';
import { config } from '$lib/server/config';

export const SESSION_COOKIE = 'lifeadmin_session';

export function setSessionCookie(cookies: Cookies, token: string): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: config.cookieSecure,
		maxAge: ABSOLUTE_LIFETIME_DAYS * 86_400
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
