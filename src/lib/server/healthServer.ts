import http from 'node:http';
import { config } from './config';
import { getHealth, getLiveHealth, getReadyHealth } from './health';

const allowedPaths = new Set(['/health/live', '/health', '/health/ready']);

function respond(res: http.ServerResponse, status: number, body: string): void {
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'x-content-type-options': 'nosniff'
	});
	res.end(body);
}

export function createHealthServer(): http.Server {
	return http.createServer((req, res) => {
		if (req.method !== 'GET' || !req.url || !allowedPaths.has(req.url.split('?')[0])) {
			respond(res, 404, '{"status":"fail"}');
			return;
		}
		req.resume();
		if (req.url.split('?')[0] === '/health/live') {
			respond(res, 200, JSON.stringify(getLiveHealth()));
			return;
		}
		if (req.url.split('?')[0] === '/health/ready') {
			const health = getReadyHealth();
			respond(res, health.status === 'ok' ? 200 : 503, JSON.stringify(health));
			return;
		}
		respond(res, 200, JSON.stringify(getHealth()));
	});
}

export function startHealthServer(): http.Server {
	const server = createHealthServer();
	server.listen(config.healthPort, '0.0.0.0');
	const shutdown = () => {
		if (server.listening) server.close();
	};
	process.once('SIGTERM', shutdown);
	process.once('SIGINT', shutdown);
	return server;
}
