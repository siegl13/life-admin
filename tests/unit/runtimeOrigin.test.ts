import { describe, expect, it } from 'vitest';
import type { IncomingHttpHeaders } from 'node:http';
import {
	INTERNAL_HOST_HEADER,
	INTERNAL_PROTOCOL_HEADER,
	parseOrigin,
	resolveOriginModel
} from '../../runtime/origin.js';

describe('parseOrigin', () => {
	it.each([
		['http://life-admin.test', 'http://life-admin.test'],
		['https://life-admin.test:8443', 'https://life-admin.test:8443'],
		['http://192.168.1.20:3000/', 'http://192.168.1.20:3000'],
		['http://life-admin.test:80', 'http://life-admin.test'],
		['https://life-admin.test:443/', 'https://life-admin.test'],
		['HTTPS://Life-Admin.Test:443', 'https://life-admin.test']
	])('accepts %s', (value, origin) => {
		expect(parseOrigin(value).origin).toBe(origin);
	});

	it.each([
		'life-admin.test',
		'ftp://life-admin.test',
		'https://life-admin.test/app',
		'https://life-admin.test//',
		'https://life-admin.test\\app',
		'https://life-admin.test\\',
		'https://life-admin.test?x=1',
		'https://life-admin.test#top',
		'https://user:secret@life-admin.test',
		'null'
	])('rejects %s', (value) => {
		expect(() => parseOrigin(value)).toThrow(/Invalid ORIGIN/);
	});
});

describe('resolveOriginModel', () => {
	function injected(env: Record<string, string>): IncomingHttpHeaders {
		const headers: IncomingHttpHeaders = {
			// A client forging the internal headers must always be overwritten.
			[INTERNAL_PROTOCOL_HEADER]: 'https',
			[INTERNAL_HOST_HEADER]: 'evil.example'
		};
		resolveOriginModel(env).injectHeaders(headers);
		return headers;
	}

	it('treats empty values as unset', () => {
		expect(
			resolveOriginModel({ ORIGIN: '', PROTOCOL_HEADER: ' ', HOST_HEADER: '', PORT_HEADER: '' })
				.mode
		).toBe('direct');
	});

	it('uses plain HTTP and ignores forwarded headers by default', () => {
		const model = resolveOriginModel({});
		expect(model.mode).toBe('direct');
		expect(model.adapterEnv).toEqual({ PROTOCOL_HEADER: INTERNAL_PROTOCOL_HEADER });
		expect(injected({})).toEqual({
			[INTERNAL_PROTOCOL_HEADER]: 'http',
			[INTERNAL_HOST_HEADER]: 'evil.example'
		});
	});

	it('pins protocol and host from ORIGIN and clears PORT_HEADER', () => {
		const env = {
			ORIGIN: 'https://life-admin.test:8443',
			PROTOCOL_HEADER: 'x-forwarded-proto',
			PORT_HEADER: 'x-forwarded-port'
		};
		const model = resolveOriginModel(env);
		expect(model.mode).toBe('origin');
		expect(model.adapterEnv).toEqual({
			PROTOCOL_HEADER: INTERNAL_PROTOCOL_HEADER,
			HOST_HEADER: INTERNAL_HOST_HEADER,
			PORT_HEADER: ''
		});
		expect(injected(env)).toEqual({
			[INTERNAL_PROTOCOL_HEADER]: 'https',
			[INTERNAL_HOST_HEADER]: 'life-admin.test:8443'
		});
	});

	it('normalizes an explicit default port in ORIGIN', () => {
		const env = { ORIGIN: 'https://life-admin.test:443' };
		expect(injected(env)).toEqual({
			[INTERNAL_PROTOCOL_HEADER]: 'https',
			[INTERNAL_HOST_HEADER]: 'life-admin.test'
		});
	});

	it('rejects an invalid ORIGIN', () => {
		expect(() => resolveOriginModel({ ORIGIN: 'https://life-admin.test/app' })).toThrow(
			/Invalid ORIGIN/
		);
	});

	it('leaves the adapter alone when the operator trusts a protocol header', () => {
		const model = resolveOriginModel({ PROTOCOL_HEADER: 'x-forwarded-proto' });
		expect(model.mode).toBe('trusted-proxy');
		expect(model.adapterEnv).toEqual({});
	});

	it('assumes HTTP when only a host header is trusted', () => {
		const env = { HOST_HEADER: 'x-forwarded-host' };
		const model = resolveOriginModel(env);
		expect(model.mode).toBe('trusted-proxy');
		expect(model.adapterEnv).toEqual({ PROTOCOL_HEADER: INTERNAL_PROTOCOL_HEADER });
		expect(injected(env)[INTERNAL_PROTOCOL_HEADER]).toBe('http');
	});
});
