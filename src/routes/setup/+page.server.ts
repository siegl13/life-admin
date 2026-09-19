import { error, fail, redirect } from '@sveltejs/kit';
import { createOwner } from '$lib/application/auth/createOwner';
import {
	accountsPort,
	clock,
	idsPort,
	passwordHasherPort,
	sessionsPort,
	tokensPort
} from '$lib/server/appPorts';
import { setSessionCookie } from '$lib/server/auth/cookies';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	if (accountsPort.ownerExists()) error(404, 'Not found');
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		try {
			const result = await createOwner(
				{
					accounts: accountsPort,
					sessions: sessionsPort,
					tokens: tokensPort,
					hasher: passwordHasherPort,
					clock,
					newId: idsPort.newId
				},
				{
					username: String(data.get('username') ?? ''),
					password: String(data.get('password') ?? ''),
					confirmation: String(data.get('confirmation') ?? '')
				}
			);
			setSessionCookie(cookies, result.token);
		} catch {
			return fail(400, { error: 'auth.setup.failed' });
		}
		redirect(303, '/');
	}
};
