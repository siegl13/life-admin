import { describe, expect, it } from 'vitest';
import {
	attachmentDisplayName,
	detectAttachmentMimeType,
	formatByteSize,
	isValidStorageKey,
	normalizeAttachmentDisplayName,
	sanitizeFilename
} from './attachment';

describe('attachment display names', () => {
	it('falls back to the immutable filename for null and blank stored names', () => {
		expect(attachmentDisplayName({ displayName: null, filename: 'original.pdf' })).toBe(
			'original.pdf'
		);
		expect(attachmentDisplayName({ displayName: '  ', filename: 'original.pdf' })).toBe(
			'original.pdf'
		);
	});

	it('removes C0, C1, and format controls before collapsing ECMAScript whitespace', () => {
		expect(normalizeAttachmentDisplayName('\u0000 A\u0085\u200b\u00a0\u2003 B\u0007')).toBe('A B');
	});

	it('returns null when transformations leave an empty value', () => {
		expect(normalizeAttachmentDisplayName('\u0000\u200b\u00a0')).toBeNull();
	});

	it('does not apply Unicode normalization', () => {
		const decomposed = 'Cafe\u0301';
		expect(normalizeAttachmentDisplayName(decomposed)).toBe(decomposed);
	});

	it('counts astral characters as one code point and accepts exactly 120', () => {
		expect(normalizeAttachmentDisplayName('😀'.repeat(120))).toBe('😀'.repeat(120));
	});

	it('rejects 121 code points without truncating', () => {
		expect(() => normalizeAttachmentDisplayName('😀'.repeat(121))).toThrow(
			'ATTACHMENT_DISPLAY_NAME_TOO_LONG'
		);
	});
});

describe('sanitizeFilename', () => {
	it('replaces path separators and control characters, never returning them', () => {
		expect(sanitizeFilename('a/b\\c')).toBe('a_b_c');
		expect(sanitizeFilename('name\0with\0nul')).toBe('name_with_nul');
		expect(sanitizeFilename('line1\nline2')).toBe('line1_line2');
	});
	it('strips leading dots so nothing looks like a dotfile', () => {
		expect(sanitizeFilename('...secret')).toBe('secret');
	});
	it('falls back to "dokument" for input that is empty or all illegal', () => {
		expect(sanitizeFilename('')).toBe('dokument');
		expect(sanitizeFilename('   ')).toBe('dokument');
		expect(sanitizeFilename('///')).toBe('dokument');
	});
	it('truncates long names to 200 characters while keeping a short extension', () => {
		const long = 'a'.repeat(250) + '.pdf';
		const result = sanitizeFilename(long);
		expect(result.length).toBe(200);
		expect(result.endsWith('.pdf')).toBe(true);
	});
	it('collapses whitespace runs', () => {
		expect(sanitizeFilename('a    b')).toBe('a b');
	});
});

describe('detectAttachmentMimeType', () => {
	it('recognizes all four supported signatures', () => {
		expect(detectAttachmentMimeType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(
			'application/pdf'
		);
		expect(detectAttachmentMimeType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
		expect(
			detectAttachmentMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		).toBe('image/png');
		const webp = new Uint8Array(12);
		webp.set([0x52, 0x49, 0x46, 0x46], 0);
		webp.set([0x57, 0x45, 0x42, 0x50], 8);
		expect(detectAttachmentMimeType(webp)).toBe('image/webp');
	});
	it('returns null for an SVG payload disguised with any extension', () => {
		const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
		expect(detectAttachmentMimeType(svg)).toBeNull();
	});
	it('returns null for plain text and for input shorter than the shortest signature', () => {
		expect(detectAttachmentMimeType(new TextEncoder().encode('hello'))).toBeNull();
		expect(detectAttachmentMimeType(new Uint8Array([0xff, 0xd8]))).toBeNull();
	});
});

describe('isValidStorageKey', () => {
	it('accepts a well-formed <fan-out>/<uuid v4> key', () => {
		expect(isValidStorageKey('ab/12345678-1234-4123-8123-123456789012')).toBe(true);
	});
	it('rejects traversal, an absolute path, uppercase hex, and a missing fan-out segment', () => {
		expect(isValidStorageKey('../../etc/passwd')).toBe(false);
		expect(isValidStorageKey('/ab/12345678-1234-4123-8123-123456789012')).toBe(false);
		expect(isValidStorageKey('AB/12345678-1234-4123-8123-123456789012')).toBe(false);
		expect(isValidStorageKey('12345678-1234-4123-8123-123456789012')).toBe(false);
	});
});

describe('formatByteSize', () => {
	it('renders bytes, kilobytes, and megabytes', () => {
		expect(formatByteSize(500)).toBe('500 B');
		expect(formatByteSize(2048)).toBe('2.0 KB');
		expect(formatByteSize(5 * 1024 * 1024)).toBe('5.0 MB');
	});
});
