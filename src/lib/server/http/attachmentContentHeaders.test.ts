import { describe, expect, it } from 'vitest';
import { attachmentContentHeaders, attachmentDisposition } from './attachmentContentHeaders';

const attachment = { filename: 'Rechnung ä\r\n.pdf', mimeType: 'application/pdf', byteSize: 42 };

describe('attachment content headers', () => {
	it.each(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])(
		'allows inline display only for the exact allowlisted type %s',
		(mimeType) => {
			const headers = attachmentContentHeaders({ ...attachment, mimeType }, false);
			expect(headers['content-disposition']).toMatch(/^inline;/);
			expect(headers['x-frame-options']).toBe(
				mimeType === 'application/pdf' ? 'SAMEORIGIN' : 'DENY'
			);
		}
	);

	it('forces explicit and unsupported downloads to attachment with DENY', () => {
		for (const headers of [
			attachmentContentHeaders(attachment, true),
			attachmentContentHeaders({ ...attachment, mimeType: 'text/html' }, false)
		]) {
			expect(headers['content-disposition']).toMatch(/^attachment;/);
			expect(headers['x-frame-options']).toBe('DENY');
			expect(headers['x-content-type-options']).toBe('nosniff');
			expect(headers['cache-control']).toBe('private, no-store');
			expect(headers['content-security-policy']).toBe("default-src 'none'; sandbox");
		}
	});

	it('bounds and sanitizes the ASCII filename while encoding the original safely', () => {
		const value = attachmentDisposition(`${'a'.repeat(250)}\r\nä.pdf`, false);
		const ascii = value.match(/filename="([^"]*)"/)?.[1];
		expect(ascii).toHaveLength(200);
		expect(value).not.toContain('\r');
		expect(value).not.toContain('\n');
		expect(value).toContain("filename*=UTF-8''");
	});

	it('handles malformed surrogate input without creating an unbounded header', () => {
		const value = attachmentDisposition(`name-\ud800-${'😀'.repeat(250)}`, true);
		expect(value).toMatch(/^inline;/);
		expect(value.length).toBeLessThan(3000);
	});
});
