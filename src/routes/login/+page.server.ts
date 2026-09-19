import { fail, redirect } from '@sveltejs/kit';
import { AccountLockedError, login } from '$lib/application/auth/login';
import {
	accountsPort,
	clock,
	passwordHasherPort,
	sessionsPort,
	tokensPort
} from '$lib/server/appPorts';
import { setSessionCookie } from '$lib/server/auth/cookies';
import { safeRedirectTarget } from '$lib/server/auth/redirectTarget';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (!accountsPort.ownerExists()) redirect(303, '/setup');
	if (locals.user) redirect(303, '/');
	return { redirectTo: safeRedirectTarget(url.searchParams.get('redirectTo')) };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const redirectTo = safeRedirectTarget(String(data.get('redirectTo') ?? '/'));
		try {
			const result = await login(
				{
					accounts: accountsPort,
					sessions: sessionsPort,
					tokens: tokensPort,
					hasher: passwordHasherPort,
					clock
				},
				{
					username: String(data.get('username') ?? ''),
					password: String(data.get('password') ?? '')
				}
			);
			setSessionCookie(cookies, result.token);
		} catch (cause) {
			if (cause instanceof AccountLockedError)
				return fail(400, { lockedMinutes: cause.minutes, redirectTo });
			return fail(400, { failed: true, redirectTo });
		}
		redirect(303, redirectTo);
	}
};
