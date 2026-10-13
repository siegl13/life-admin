import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createHealthServer } from './healthServer';

describe('health listener', () => {
	let server: ReturnType<typeof createHealthServer> | undefined;
	afterEach(async () => {
		if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
		server = undefined;
	});

	it('serves only the three read-only GET endpoints', async () => {
		server = createHealthServer();
		await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
		const port = (server.address() as AddressInfo).port;
		for (const path of ['/health/live', '/health', '/health/ready']) {
			const response = await fetch(`http://127.0.0.1:${port}${path}`);
			expect([200, 503]).toContain(response.status);
		}
		for (const path of ['/login', '/healthz', '/health/other', '/']) {
			const response = await fetch(`http://127.0.0.1:${port}${path}`);
			expect(response.status).toBe(404);
		}
		for (const method of ['POST', 'PUT', 'DELETE']) {
			const response = await fetch(`http://127.0.0.1:${port}/health`, { method });
			expect(response.status).toBe(404);
		}
	});
});
