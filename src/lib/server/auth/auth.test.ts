import { describe, expect, it } from 'vitest';
import { passwordHasher } from './passwordHasher';
import { newSessionToken } from './sessionToken';
import { safeRedirectTarget } from './redirectTarget';

describe('server authentication primitives', () => {
	it('hashes and verifies with self-describing scrypt parameters', async () => {
		const hash = await passwordHasher.hash('correct horse battery staple');
		expect(hash).toContain('scrypt$N=65536,r=8,p=1$');
		expect(await passwordHasher.verify('correct horse battery staple', hash)).toBe(true);
		expect(await passwordHasher.verify('wrong', hash)).toBe(false);
		expect(await passwordHasher.verify('anything', 'malformed')).toBe(false);
	});

	it('creates non-replayable session token pairs', () => {
		const value = newSessionToken();
		expect(value.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(value.tokenHash).toMatch(/^[a-f0-9]{64}$/);
		expect(value.tokenHash).not.toBe(value.token);
	});

	it('accepts local redirects only', () => {
		expect(safeRedirectTarget('/items/a?x=1')).toBe('/items/a?x=1');
		expect(safeRedirectTarget('https://evil.example')).toBe('/');
		expect(safeRedirectTarget('//evil.example')).toBe('/');
	});
});
