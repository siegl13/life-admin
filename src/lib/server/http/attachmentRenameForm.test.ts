import { describe, expect, it, vi } from 'vitest';
import type { Attachment } from '$lib/domain/attachment/attachment';
import { parseAttachmentRenameForm, submitAttachmentRenameForm } from './attachmentRenameForm';

const attachment = (id: string, displayName: string | null = null) =>
	({ id, displayName }) as Attachment;

describe('submitAttachmentRenameForm', () => {
	it.each([
		[
			'duplicate attachment id',
			[
				['attachmentId', 'att-1'],
				['attachmentId', 'att-1'],
				['displayName:att-1', 'One']
			]
		],
		[
			'duplicate display name',
			[
				['attachmentId', 'att-1'],
				['displayName:att-1', 'One'],
				['displayName:att-1', 'Two']
			]
		],
		['missing display name', [['attachmentId', 'att-1']]],
		[
			'foreign display name',
			[
				['attachmentId', 'att-1'],
				['displayName:att-1', 'One'],
				['displayName:foreign', 'Foreign']
			]
		]
	])('rejects %s fields at the HTTP form boundary', (_label, fields) => {
		const data = new FormData();
		for (const [key, value] of fields) data.append(key, value);
		expect(() => parseAttachmentRenameForm(data)).toThrow('ATTACHMENT_NOT_FOUND');
	});

	it('parses every submitted attachment id and display name once', () => {
		const data = new FormData();
		data.append('attachmentId', 'att-1');
		data.append('displayName:att-1', 'One');
		data.append('attachmentId', 'att-2');
		data.append('displayName:att-2', 'Two');
		expect(parseAttachmentRenameForm(data)).toEqual([
			{ attachmentId: 'att-1', displayName: 'One' },
			{ attachmentId: 'att-2', displayName: 'Two' }
		]);
	});

	it.each([
		[
			'duplicate',
			[
				{ attachmentId: 'att-1', displayName: 'One' },
				{ attachmentId: 'att-1', displayName: 'Two' }
			]
		],
		['foreign', [{ attachmentId: 'foreign', displayName: 'One' }]],
		['missing', [{ attachmentId: 'att-1', displayName: 'One' }]],
		[
			'invalid name',
			[
				{ attachmentId: 'att-1', displayName: 'x'.repeat(121) },
				{ attachmentId: 'att-2', displayName: 'Two' }
			]
		]
	])('rejects %s submissions before any singular rename', (_label, entries) => {
		const rename = vi.fn();
		expect(() =>
			submitAttachmentRenameForm([attachment('att-1'), attachment('att-2')], entries, rename)
		).toThrow();
		expect(rename).not.toHaveBeenCalled();
	});

	it('skips unchanged names and invokes changed singular renames sequentially', () => {
		const rename = vi.fn();
		submitAttachmentRenameForm(
			[attachment('att-1', 'Same'), attachment('att-2'), attachment('att-3')],
			[
				{ attachmentId: 'att-1', displayName: 'Same' },
				{ attachmentId: 'att-2', displayName: '  Two  ' },
				{ attachmentId: 'att-3', displayName: 'Three' }
			],
			rename
		);
		expect(rename.mock.calls).toEqual([
			[{ attachmentId: 'att-2', displayName: 'Two' }],
			[{ attachmentId: 'att-3', displayName: 'Three' }]
		]);
	});

	it('keeps a completed rename when a deterministic fake persistence port fails, then retries safely', () => {
		const rows = [attachment('att-1'), attachment('att-2')];
		let failSecond = true;
		const rename = vi.fn(({ attachmentId, displayName }) => {
			if (attachmentId === 'att-2' && failSecond)
				throw new Error('deterministic persistence failure');
			rows.find((row) => row.id === attachmentId)!.displayName = displayName;
		});
		const entries = [
			{ attachmentId: 'att-1', displayName: 'One' },
			{ attachmentId: 'att-2', displayName: 'Two' }
		];

		expect(() => submitAttachmentRenameForm(rows, entries, rename)).toThrow(
			'deterministic persistence failure'
		);
		expect(rows.map((row) => row.displayName)).toEqual(['One', null]);

		failSecond = false;
		submitAttachmentRenameForm(rows, entries, rename);
		expect(rows.map((row) => row.displayName)).toEqual(['One', 'Two']);
	});
});
