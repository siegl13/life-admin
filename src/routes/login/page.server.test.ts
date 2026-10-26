import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidCredentialsError } from '$lib/application/auth/login';

const { login } = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('$lib/application/auth/login', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/application/auth/login')>()),
	login
}));
vi.mock('$lib/server/appPorts', () => ({
	accountsPort: {},
	clock: {},
	passwordHasherPort: {},
	sessionsPort: {},
	tokensPort: {}
}));
vi.mock('$lib/server/config', () => ({ config: { cookieSecure: false } }));

import { actions } from './+page.server';

function request(): Request {
	const data = new FormData();
	data.set('username', 'owner');
	data.set('password', 'wrong');
	return new Request('http://localhost/login', { method: 'POST', body: data });
}

describe('login action errors', () => {
	beforeEach(() => vi.resetAllMocks());

	it('returns a form error for invalid credentials', async () => {
		login.mockRejectedValue(new InvalidCredentialsError());
		await expect(actions.default({ request: request() } as never)).resolves.toMatchObject({
			status: 400,
			data: { failed: true }
		});
	});

	it('propagates unexpected persistence errors to the error handler', async () => {
		const failure = new Error('database unavailable');
		login.mockRejectedValue(failure);
		await expect(actions.default({ request: request() } as never)).rejects.toBe(failure);
	});
});
