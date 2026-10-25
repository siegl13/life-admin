import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

// Starts the already-built production artifact (`build/`, built without any
// origin) through its real entry point with different runtime settings. The
// build is never repeated between cases, so each case proves that one
// artifact serves any hostname.

const PASSWORD = 'pr59-disposable-test-password';
const servers: ChildProcess[] = [];

test.afterEach(async () => {
	await Promise.all(servers.splice(0).map(stop));
});

test('direct HTTP on a non-localhost host accepts same-origin POST and rejects foreign origins', async () => {
	const { port } = await startServer('direct');
	const host = `life-admin.test:${port}`;

	expect((await send(port, 'GET', '/setup', { host })).status).toBe(200);
	expect((await postSetup(port, { host, origin: 'https://evil.example' })).status).toBe(403);
	expect((await postSetup(port, { host, origin: `https://${host}` })).status).toBe(403);

	const accepted = await postSetup(port, { host, origin: `http://${host}` });
	expect(accepted.status).toBe(303);
	expect(accepted.setCookie).toContain('=');
});

test('direct mode ignores forwarded headers sent by a client', async () => {
	const { port } = await startServer('direct');
	const forged = {
		'x-forwarded-proto': 'https',
		'x-forwarded-host': 'evil.example',
		host: `life-admin.test:${port}`
	};

	const attack = await postSetup(port, { ...forged, origin: 'https://evil.example' });
	expect(attack.status).toBe(403);

	const accepted = await postSetup(port, { ...forged, origin: `http://${forged.host}` });
	expect(accepted.status).toBe(303);
});

test('runtime ORIGIN pins the only accepted origin', async () => {
	const { port } = await startServer('origin', { ORIGIN: 'http://runtime-origin.test:43059' });
	const host = `127.0.0.1:${port}`;

	expect((await send(port, 'GET', '/setup', { host })).status).toBe(200);
	expect((await postSetup(port, { host, origin: `http://${host}` })).status).toBe(403);
	expect((await postSetup(port, { host, origin: 'https://evil.example' })).status).toBe(403);

	const accepted = await postSetup(port, { host, origin: 'http://runtime-origin.test:43059' });
	expect(accepted.status).toBe(303);
});

test('runtime ORIGIN with an explicit default port starts and matches the browser origin', async () => {
	const { port } = await startServer('origin-default-port', {
		ORIGIN: 'http://runtime-origin.test:80'
	});
	const host = `127.0.0.1:${port}`;

	expect((await postSetup(port, { host, origin: 'http://runtime-origin.test:80' })).status).toBe(
		403
	);
	const accepted = await postSetup(port, { host, origin: 'http://runtime-origin.test' });
	expect(accepted.status).toBe(303);
});

test('trusted proxy headers define the origin only when configured', async () => {
	const { port } = await startServer('trusted-proxy', {
		PROTOCOL_HEADER: 'x-forwarded-proto',
		HOST_HEADER: 'x-forwarded-host'
	});
	const proxied = {
		host: `127.0.0.1:${port}`,
		'x-forwarded-proto': 'https',
		'x-forwarded-host': 'proxy-origin.test'
	};

	expect((await send(port, 'GET', '/setup', proxied)).status).toBe(200);
	expect((await postSetup(port, { ...proxied, origin: 'https://evil.example' })).status).toBe(403);

	const accepted = await postSetup(port, { ...proxied, origin: 'https://proxy-origin.test' });
	expect(accepted.status).toBe(303);
});

test('invalid ORIGIN stops the server at startup', async () => {
	for (const origin of [
		'life-admin.test',
		'ftp://life-admin.test',
		'https://life-admin.test/app',
		'https://life-admin.test\\app',
		'https://user:secret@life-admin.test'
	]) {
		const result = await runToExit({ ORIGIN: origin });
		expect(result.code, origin).toBe(1);
		expect(result.stderr, origin).toContain('Invalid ORIGIN');
	}
});

async function startServer(name: string, env: Record<string, string> = {}) {
	const port = await freePort();
	const dataDir = path.resolve('.data-e2e', `runtime-origin-${name}-${port}`);
	fs.rmSync(dataDir, { recursive: true, force: true });
	const child = spawnEntryPoint({ PORT: String(port), LIFEADMIN_DATA_DIR: dataDir, ...env });
	servers.push(child);
	await waitForListening(child);
	return { port };
}

function spawnEntryPoint(env: Record<string, string>): ChildProcess {
	return spawn('node', ['runtime/start.js'], {
		env: {
			...process.env,
			ORIGIN: '',
			PROTOCOL_HEADER: '',
			HOST_HEADER: '',
			PORT_HEADER: '',
			LIFEADMIN_DISABLE_SCHEDULER: '1',
			...env
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

function waitForListening(child: ChildProcess): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('server did not start')), 20_000);
		child.stdout?.on('data', (chunk: Buffer) => {
			if (chunk.toString().includes('Listening on')) {
				clearTimeout(timer);
				resolve();
			}
		});
		child.once('exit', (code) => {
			clearTimeout(timer);
			reject(new Error(`server exited early with code ${code}`));
		});
	});
}

function runToExit(env: Record<string, string>): Promise<{ code: number | null; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawnEntryPoint({ PORT: '0', ...env });
		let stderr = '';
		child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
		child.once('exit', (code) => resolve({ code, stderr }));
	});
}

function stop(child: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		if (child.exitCode !== null) return resolve();
		child.once('exit', () => resolve());
		child.kill('SIGTERM');
	});
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as net.AddressInfo;
			probe.close(() => resolve(port));
		});
	});
}

function postSetup(port: number, headers: Record<string, string>) {
	const body = new URLSearchParams({
		username: 'origin-test',
		password: PASSWORD,
		confirmation: PASSWORD
	}).toString();
	return send(
		port,
		'POST',
		'/setup',
		{
			...headers,
			// Without an HTML Accept header SvelteKit answers an action redirect with JSON 200.
			accept: 'text/html',
			'content-type': 'application/x-www-form-urlencoded',
			'content-length': String(Buffer.byteLength(body))
		},
		body
	);
}

/** Connects to 127.0.0.1 and sends the given headers verbatim, so the Host header can name any hostname. */
function send(
	port: number,
	method: string,
	requestPath: string,
	headers: Record<string, string>,
	body?: string
): Promise<{ status: number; setCookie: string }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ host: '127.0.0.1', port, method, path: requestPath, headers, timeout: 10_000 },
			(res) => {
				res.resume();
				res.once('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						setCookie: String(res.headers['set-cookie'] ?? '')
					})
				);
			}
		);
		req.once('error', reject);
		req.end(body);
	});
}
