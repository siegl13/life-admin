import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidPasswordError } from '$lib/application/auth/createOwner';

const { createOwner } = vi.hoisted(() => ({ createOwner: vi.fn() }));
vi.mock('$lib/application/auth/createOwner', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/application/auth/createOwner')>()),
	createOwner
}));
vi.mock('$lib/server/appPorts', () => ({
	accountsPort: {},
	clock: {},
	idsPort: {},
	passwordHasherPort: {},
	sessionsPort: {},
	tokensPort: {}
}));
vi.mock('$lib/server/config', () => ({ config: { cookieSecure: false } }));

import { actions } from './+page.server';

function request(): Request {
	const data = new FormData();
	data.set('username', 'owner');
	data.set('password', 'invalid');
	data.set('confirmation', 'invalid');
	return new Request('http://localhost/setup', { method: 'POST', body: data });
}

describe('setup action errors', () => {
	beforeEach(() => vi.resetAllMocks());

	it('returns a form error for an invalid password', async () => {
		createOwner.mockRejectedValue(new InvalidPasswordError());
		await expect(actions.default({ request: request() } as never)).resolves.toMatchObject({
			status: 400,
			data: { error: 'auth.setup.failed' }
		});
	});

	it('propagates unexpected persistence errors to the error handler', async () => {
		const failure = new Error('database unavailable');
		createOwner.mockRejectedValue(failure);
		await expect(actions.default({ request: request() } as never)).rejects.toBe(failure);
	});
});
