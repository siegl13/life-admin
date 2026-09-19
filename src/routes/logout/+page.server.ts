import { redirect } from '@sveltejs/kit';
import { logout } from '$lib/application/auth/logout';
import { sessionsPort } from '$lib/server/appPorts';
import { clearSessionCookie, SESSION_COOKIE } from '$lib/server/auth/cookies';
import { hashSessionToken } from '$lib/server/auth/sessionToken';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(303, '/');
export const actions: Actions = {
	default: ({ cookies }) => {
		const token = cookies.get(SESSION_COOKIE);
		logout(sessionsPort, token ? hashSessionToken(token) : null);
		clearSessionCookie(cookies);
		redirect(303, '/login');
	}
};
