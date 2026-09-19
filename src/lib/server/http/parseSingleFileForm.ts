import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import busboy from 'busboy';

/**
 * Streams a multipart/form-data request straight to a temp file on disk,
 * never buffering the whole body in memory the way `await request.formData()`
 * does. This is not a generic form parser and never will be: it supports
 * exactly one file part and a small, bounded number of short text fields,
 * which is all the restore-upload and attachment-upload routes need.
 */

export class MultipartMalformedError extends Error {}
export class MultipartTooManyFilesError extends Error {}
export class MultipartFileTooLargeError extends Error {}
export class MultipartFieldTooLargeError extends Error {}
export class MultipartTooManyPartsError extends Error {}

export interface ParsedFile {
	fieldName: string;
	filename: string;
	mimeType: string;
	path: string;
	byteLength: number;
}

export interface ParsedSingleFileForm {
	fields: Record<string, string>;
	file: ParsedFile | null;
}

export interface ParseSingleFileFormOptions {
	/** Directory the temp file is written into. Created if missing. */
	destDir: string;
	maxFileBytes: number;
	maxFieldBytes: number;
	maxFields: number;
}

/** Cleans up a partially-written temp file. Best effort: this runs only on
 *  a failure path, and a failure to remove a `.part` file is caught by
 *  the existing startup `.part` sweep (attachmentStorage.cleanStalePartFiles),
 *  not treated as a second error here. */
function safeUnlink(filePath: string | null): void {
	if (filePath) fs.rmSync(filePath, { force: true });
}

export async function parseSingleFileForm(
	request: Request,
	options: ParseSingleFileFormOptions
): Promise<ParsedSingleFileForm> {
	const contentType = request.headers.get('content-type');
	if (!contentType || !contentType.startsWith('multipart/form-data') || !request.body) {
		throw new MultipartMalformedError('missing or non-multipart content-type');
	}
	fs.mkdirSync(options.destDir, { recursive: true });

	return await new Promise((resolve, reject) => {
		let settled = false;
		let currentFilePath: string | null = null;
		let fileWritePromise: Promise<void> = Promise.resolve();
		// fs.createWriteStream's own open() is async, so right after the 'file'
		// handler runs the temp file may not exist on disk yet. Cleaning up
		// immediately would race that open() and can leave an orphaned empty
		// file behind (the open completing after our unlink). Waiting for the
		// stream's own 'close' event guarantees the open (if it ever happens)
		// has already settled, so the unlink below always sees the real state.
		let currentFileClosed: Promise<void> = Promise.resolve();

		const fail = (error: Error) => {
			if (settled) return;
			settled = true;
			currentFileClosed.then(() => {
				safeUnlink(currentFilePath);
				reject(error);
			});
		};

		let bb: ReturnType<typeof busboy>;
		try {
			bb = busboy({
				headers: { 'content-type': contentType },
				limits: {
					fileSize: options.maxFileBytes,
					fieldSize: options.maxFieldBytes,
					fields: options.maxFields,
					files: 1,
					// busboy's internal `parts` counter increments once per boundary
					// match, including the closing terminator boundary — so a body
					// with exactly N real parts (fields + file) drives the counter to
					// N, one past the "N-1 matches for N parts" one might expect.
					// +2 (not +1) keeps a request with exactly maxFields fields plus
					// the one file from tripping this limit on its own last, entirely
					// legitimate part. See parseSingleFileForm.test.ts's tight-limit
					// regression test.
					parts: options.maxFields + 2
				}
			});
		} catch (cause) {
			reject(
				new MultipartMalformedError(
					cause instanceof Error ? cause.message : 'invalid multipart request'
				)
			);
			return;
		}

		const fields: Record<string, string> = {};
		let result: ParsedFile | null = null;

		bb.on('field', (name, value, info) => {
			if (info.nameTruncated || info.valueTruncated) {
				fail(new MultipartFieldTooLargeError(`form field "${name}" exceeds the allowed size`));
				return;
			}
			fields[name] = value;
		});

		bb.on('file', (name, stream, info) => {
			if (settled) {
				stream.resume();
				return;
			}
			const filePath = path.join(options.destDir, `upload-${randomUUID()}.part`);
			currentFilePath = filePath;
			const out = fs.createWriteStream(filePath, { flags: 'wx' });
			let byteLength = 0;
			currentFileClosed = new Promise((res) => out.once('close', () => res()));

			fileWritePromise = new Promise<void>((res, rej) => {
				stream.on('data', (chunk: Buffer) => {
					byteLength += chunk.byteLength;
				});
				stream.on('limit', () => {
					stream.unpipe(out);
					out.destroy();
					stream.resume(); // drain the rest so busboy can finish cleanly
					rej(new MultipartFileTooLargeError('uploaded file exceeds the allowed size'));
				});
				stream.pipe(out);
				out.on('finish', () => {
					if (stream.truncated) return; // 'limit' handler above already rejected
					result = {
						fieldName: name,
						filename: info.filename,
						mimeType: info.mimeType,
						path: filePath,
						byteLength
					};
					res();
				});
				out.on('error', (cause) => rej(cause instanceof Error ? cause : new Error('write failed')));
			});
			// bb.on('close', ...) below is the real consumer, but it only
			// attaches once busboy finishes, which is strictly later than a
			// same-tick 'limit' rejection above — attach a no-op catch now so
			// Node never logs a spurious "unhandled rejection" in the gap.
			fileWritePromise.catch(() => {});
		});

		bb.on('filesLimit', () => fail(new MultipartTooManyFilesError('more than one file part')));
		bb.on('fieldsLimit', () => fail(new MultipartTooManyPartsError('too many form fields')));
		bb.on('partsLimit', () => fail(new MultipartTooManyPartsError('too many form parts')));
		bb.on('error', (cause) =>
			fail(cause instanceof Error ? cause : new MultipartMalformedError('malformed multipart body'))
		);
		bb.on('close', () => {
			fileWritePromise.then(
				() => {
					if (settled) return;
					settled = true;
					resolve({ fields, file: result });
				},
				(cause: unknown) => fail(cause instanceof Error ? cause : new Error('file write failed'))
			);
		});

		Readable.fromWeb(request.body as never).pipe(bb);
	});
}
