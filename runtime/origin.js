// Runtime origin model for the production server (see runtime/start.js).
//
// @sveltejs/adapter-node 6 no longer reads ORIGIN at runtime. Unless an origin
// is baked in at build time, it builds the request URL from request headers and
// assumes HTTPS when no protocol header is configured. That breaks same-origin
// form POSTs on plain HTTP. Life Admin builds one image without an origin, so
// this module decides the protocol and host headers the adapter should use.

/** Headers only this process writes. Any client-sent value is overwritten. */
import { URL } from 'node:url';

export const INTERNAL_PROTOCOL_HEADER = 'x-lifeadmin-origin-protocol';
export const INTERNAL_HOST_HEADER = 'x-lifeadmin-origin-host';

/**
 * Parses a configured ORIGIN. Accepts only an absolute http(s) origin:
 * no credentials, path, query or fragment. A single trailing slash is allowed.
 *
 * @param {string} value
 * @returns {URL}
 */
export function parseOrigin(value) {
	const candidate = value.trim().replace(/\/$/, '');
	let url;
	try {
		url = new URL(candidate);
	} catch {
		throw invalidOrigin(value, 'it is not an absolute URL');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw invalidOrigin(value, 'the scheme must be http or https');
	}
	// url.host drops an explicit default port (:80 for http, :443 for https), so
	// check the authority-only shape on the raw text instead of comparing origins.
	// WHATWG URL treats a backslash as a slash, so reject it explicitly.
	const authorityOnly = /^https?:\/\/[^/\\?#@]+$/i.test(candidate);
	const hasExtraParts = url.pathname !== '/' || url.search !== '' || url.hash !== '';
	if (!url.hostname || url.username || url.password || !authorityOnly || hasExtraParts) {
		throw invalidOrigin(value, 'it must be scheme://host[:port] with no credentials or path');
	}
	return url;
}

/** @param {string} value @param {string} reason */
function invalidOrigin(value, reason) {
	return new Error(
		`Invalid ORIGIN ${JSON.stringify(value)}: ${reason}. Example: ORIGIN=https://life-admin.example.com`
	);
}

/**
 * Decides how the adapter derives the request origin.
 *
 * - `origin`: ORIGIN is set. It is the only trusted origin. Forwarded headers
 *   are ignored for origin purposes.
 * - `trusted-proxy`: PROTOCOL_HEADER, HOST_HEADER and/or PORT_HEADER were set
 *   by the operator. The adapter reads those headers. The proxy must overwrite them.
 * - `direct`: nothing set. The origin is `http://` plus the Host header.
 *   Forwarded headers are never trusted.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{
 *   mode: 'origin' | 'trusted-proxy' | 'direct',
 *   adapterEnv: Record<string, string>,
 *   injectHeaders: (headers: import('node:http').IncomingHttpHeaders) => void
 * }}
 */
export function resolveOriginModel(env) {
	const configured = env.ORIGIN?.trim();
	if (configured) {
		const url = parseOrigin(configured);
		return {
			mode: 'origin',
			// A configured ORIGIN wins over proxy headers, so clear PORT_HEADER too.
			adapterEnv: {
				PROTOCOL_HEADER: INTERNAL_PROTOCOL_HEADER,
				HOST_HEADER: INTERNAL_HOST_HEADER,
				PORT_HEADER: ''
			},
			injectHeaders(headers) {
				headers[INTERNAL_PROTOCOL_HEADER] = url.protocol.slice(0, -1);
				headers[INTERNAL_HOST_HEADER] = url.host;
			}
		};
	}

	const protocolHeader = env.PROTOCOL_HEADER?.trim();
	const hostHeader = env.HOST_HEADER?.trim();
	const portHeader = env.PORT_HEADER?.trim();
	if (protocolHeader || hostHeader || portHeader) {
		if (protocolHeader) {
			return { mode: 'trusted-proxy', adapterEnv: {}, injectHeaders() {} };
		}
		// Host or port header trusted, but no protocol header: the connection to this
		// process is plain HTTP, so do not let the adapter assume HTTPS.
		return {
			mode: 'trusted-proxy',
			adapterEnv: { PROTOCOL_HEADER: INTERNAL_PROTOCOL_HEADER },
			injectHeaders(headers) {
				headers[INTERNAL_PROTOCOL_HEADER] = 'http';
			}
		};
	}

	return {
		mode: 'direct',
		adapterEnv: { PROTOCOL_HEADER: INTERNAL_PROTOCOL_HEADER },
		injectHeaders(headers) {
			headers[INTERNAL_PROTOCOL_HEADER] = 'http';
		}
	};
}
