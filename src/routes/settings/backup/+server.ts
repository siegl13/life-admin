import { error } from '@sveltejs/kit';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import {
	AttachmentBackupError,
	BackupTooLargeError,
	createBackup
} from '$lib/server/backup/createBackup';
import { log } from '$lib/server/log';
import { t } from '$lib/i18n';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) error(403, 'Forbidden');
	let backup: ReturnType<typeof createBackup>;
	try {
		backup = createBackup();
	} catch (cause) {
		if (cause instanceof AttachmentBackupError) {
			// Never the attachment id or any path in the response; the id is
			// still safe to log (an opaque identifier, not a path or content).
			log.warn('backup failed: attachment inconsistent with database', {
				attachmentId: cause.attachmentId
			});
			error(500, t('settings.backup.error'));
		}
		if (cause instanceof BackupTooLargeError) {
			log.warn('backup refused: planned or actual archive size exceeds the restore limit', {
				reason: cause.message
			});
			error(500, t('settings.backup.errorTooLarge'));
		}
		log.error('backup failed', { reason: cause instanceof Error ? cause.message : 'unknown' });
		error(500, t('settings.backup.error'));
	}
	const stat = fs.statSync(backup.filePath);
	const source = fs.createReadStream(backup.filePath);
	source.once('close', () => fs.rmSync(backup.filePath, { force: true }));
	return new Response(Readable.toWeb(source) as ReadableStream, {
		headers: {
			'content-type': 'application/zip',
			'content-length': String(stat.size),
			'content-disposition': `attachment; filename="${backup.filename}"`,
			'cache-control': 'no-store'
		}
	});
};
