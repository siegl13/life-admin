import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	MultipartFieldTooLargeError,
	MultipartFileTooLargeError,
	MultipartMalformedError,
	MultipartTooManyFilesError,
	MultipartTooManyPartsError,
	parseSingleFileForm
} from './parseSingleFileForm';

let destDir: string;

beforeEach(() => {
	destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-multipart-'));
});

afterEach(() => {
	fs.rmSync(destDir, { recursive: true, force: true });
});

/** Builds a real multipart/form-data Request using the platform's own
 *  FormData encoder, so the test exercises the real wire format rather
 *  than a hand-rolled approximation of it. */
function multipartRequest(form: FormData): Request {
	return new Request('http://localhost/upload', { method: 'POST', body: form });
}

describe('parseSingleFileForm', () => {
	it('streams a file to disk and reports the small text fields, without ever buffering the whole body', async () => {
		const form = new FormData();
		form.set('confirm', 'yes');
		form.set(
			'file',
			new File([new Uint8Array([1, 2, 3, 4])], 'a.bin', { type: 'application/octet-stream' })
		);

		const result = await parseSingleFileForm(multipartRequest(form), {
			destDir,
			maxFileBytes: 1_000_000,
			maxFieldBytes: 1000,
			maxFields: 5
		});

		expect(result.fields).toEqual({ confirm: 'yes' });
		expect(result.file?.filename).toBe('a.bin');
		expect(result.file?.byteLength).toBe(4);
		expect(fs.readFileSync(result.file!.path)).toEqual(Buffer.from([1, 2, 3, 4]));
	});

	it('accepts a request whose real part count exactly equals maxFields plus the file (tight-limit regression)', async () => {
		// Regression test for an off-by-one in busboy's own `parts` counter:
		// it increments once per boundary match, including the closing
		// terminator, so a naive `maxFields + 1` bound rejects the very last,
		// entirely legitimate part in a request that has no fields to spare.
		// This mirrors the real routes' exact configuration (e.g. the
		// attachment route: maxFields: 0, one file, nothing else).
		const form = new FormData();
		form.set('file', new File([new Uint8Array([9, 9])], 'a.bin'));

		const result = await parseSingleFileForm(multipartRequest(form), {
			destDir,
			maxFileBytes: 1000,
			maxFieldBytes: 1000,
			maxFields: 0
		});

		expect(result.file?.byteLength).toBe(2);
		expect(result.fields).toEqual({});
	});

	it('reports no file when none was included', async () => {
		const form = new FormData();
		form.set('confirm', 'yes');
		const result = await parseSingleFileForm(multipartRequest(form), {
			destDir,
			maxFileBytes: 1000,
			maxFieldBytes: 1000,
			maxFields: 5
		});
		expect(result.file).toBeNull();
		expect(result.fields).toEqual({ confirm: 'yes' });
	});

	it('rejects and cleans up the partial file when the upload exceeds the file-size limit', async () => {
		const form = new FormData();
		form.set('file', new File([new Uint8Array(2000)], 'big.bin'));

		await expect(
			parseSingleFileForm(multipartRequest(form), {
				destDir,
				maxFileBytes: 500,
				maxFieldBytes: 1000,
				maxFields: 5
			})
		).rejects.toThrow(MultipartFileTooLargeError);

		expect(fs.readdirSync(destDir)).toHaveLength(0);
	});

	it('rejects an oversized text field', async () => {
		const form = new FormData();
		form.set('note', 'x'.repeat(2000));

		await expect(
			parseSingleFileForm(multipartRequest(form), {
				destDir,
				maxFileBytes: 1000,
				maxFieldBytes: 100,
				maxFields: 5
			})
		).rejects.toThrow(MultipartFieldTooLargeError);
	});

	it('does not create a file when an earlier oversized field has already rejected the request', async () => {
		const form = new FormData();
		form.set('note', 'x'.repeat(2000));
		form.set('file', new File([new Uint8Array([1, 2, 3])], 'later.bin'));

		await expect(
			parseSingleFileForm(multipartRequest(form), {
				destDir,
				maxFileBytes: 1000,
				maxFieldBytes: 100,
				maxFields: 5
			})
		).rejects.toThrow(MultipartFieldTooLargeError);

		expect(fs.readdirSync(destDir)).toHaveLength(0);
	});

	it('rejects a second file part', async () => {
		const form = new FormData();
		form.set('file', new File([new Uint8Array([1])], 'a.bin'));
		form.append('file2', new File([new Uint8Array([2])], 'b.bin'));

		await expect(
			parseSingleFileForm(multipartRequest(form), {
				destDir,
				maxFileBytes: 1000,
				maxFieldBytes: 1000,
				maxFields: 5
			})
		).rejects.toThrow(MultipartTooManyFilesError);
	});

	it('rejects more form parts than the configured bound', async () => {
		const form = new FormData();
		for (let i = 0; i < 10; i++) form.set(`field${i}`, 'x');

		await expect(
			parseSingleFileForm(multipartRequest(form), {
				destDir,
				maxFileBytes: 1000,
				maxFieldBytes: 1000,
				maxFields: 3
			})
		).rejects.toThrow(MultipartTooManyPartsError);
	});

	it('rejects a request with no multipart content-type', async () => {
		const request = new Request('http://localhost/upload', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ a: 1 })
		});
		await expect(
			parseSingleFileForm(request, {
				destDir,
				maxFileBytes: 1000,
				maxFieldBytes: 1000,
				maxFields: 5
			})
		).rejects.toThrow(MultipartMalformedError);
	});

	it('rejects a malformed multipart body without crashing', async () => {
		const request = new Request('http://localhost/upload', {
			method: 'POST',
			headers: { 'content-type': 'multipart/form-data; boundary=notreal' },
			body: 'this is not a valid multipart body at all'
		});
		await expect(
			parseSingleFileForm(request, {
				destDir,
				maxFileBytes: 1000,
				maxFieldBytes: 1000,
				maxFields: 5
			})
		).rejects.toThrow();
		expect(fs.readdirSync(destDir)).toHaveLength(0);
	});
});
