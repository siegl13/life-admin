// Production entry point: `node runtime/start.js`.
//
// Validates ORIGIN and the proxy settings, then starts the adapter-node build
// unchanged. The build contains no origin, so one artifact serves any
// hostname. See runtime/origin.js for the origin model.
import console from 'node:console';
import { resolveOriginModel } from './origin.js';

let model;
try {
	model = resolveOriginModel(process.env);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

// The adapter reads these once at import time, so set them first.
Object.assign(process.env, model.adapterEnv);

const { server } = await import('../build/index.js');

// Runs before the adapter's own request listener, so the headers it reads for
// the origin are set by this process and not by the client.
server.prependListener('request', (req) => model.injectHeaders(req.headers));

console.log(`Origin mode: ${model.mode}`);
