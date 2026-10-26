import { scrypt, timingSafeEqual, randomBytes } from 'node:crypto';
import type { PasswordHasherPort } from '$lib/application/ports';

const PARAMS = { N: 65_536, r: 8, p: 1, keylen: 32 };
const MAXMEM = 96 * 1024 * 1024;

async function derive(
	plain: string,
	salt: Buffer,
	N: number,
	r: number,
	p: number
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(plain, salt, PARAMS.keylen, { N, r, p, maxmem: MAXMEM }, (cause, key) => {
			if (cause) reject(cause);
			else resolve(key);
		});
	});
}

export const passwordHasher: PasswordHasherPort = {
	async hash(plain) {
		const salt = randomBytes(16);
		const hash = await derive(plain, salt, PARAMS.N, PARAMS.r, PARAMS.p);
		return `scrypt$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
	},
	async verify(plain, stored) {
		const [algorithm, paramsText, saltText, hashText] = stored.split('$');
		if (algorithm !== 'scrypt' || !paramsText || !saltText || !hashText) return false;
		const match = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(paramsText);
		if (!match) return false;
		const [N, r, p] = match.slice(1).map(Number);
		if (
			!Number.isInteger(N) ||
			N < 2 ||
			N > PARAMS.N ||
			(N & (N - 1)) !== 0 ||
			!Number.isInteger(r) ||
			r < 1 ||
			r > PARAMS.r ||
			!Number.isInteger(p) ||
			p < 1 ||
			p > PARAMS.p
		)
			return false;
		const salt = Buffer.from(saltText, 'base64url');
		const expected = Buffer.from(hashText, 'base64url');
		if (salt.length !== 16 || expected.length !== PARAMS.keylen) return false;
		const actual = await derive(plain, salt, N, r, p);
		return timingSafeEqual(actual, expected);
	},
	needsRehash(stored) {
		return !stored.startsWith(`scrypt$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$`);
	}
};
