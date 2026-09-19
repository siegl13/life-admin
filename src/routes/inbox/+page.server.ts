import fs from 'node:fs';
import { fail, redirect } from '@sveltejs/kit';
import { MAX_ATTACHMENT_BYTES } from '$lib/domain/attachment/attachment';
import { listItems } from '$lib/application/items/listItems';
import {
	deleteInboxDocument,
	analyzeInboxDocument,
	InboxDocumentNotAvailableError,
	InboxDocumentRejectedError,
	routeInboxDocument,
	uploadInboxDocument
} from '$lib/application/inbox/documents';
import {
	MultipartFileTooLargeError,
	parseSingleFileForm
} from '$lib/server/http/parseSingleFileForm';
import {
	attachmentStoragePort,
	clock,
	idsPort,
	inboxPort,
	inboxStoragePort,
	itemsPort,
	playbooksPort,
	extractionProvider,
	appSettingsPort,
	inboxAiRunsPort
} from '$lib/server/appPorts';
import { config } from '$lib/server/config';
import { getAiSettings } from '$lib/application/ai/aiSettings';
import { restrictRoutingSuggestion } from '$lib/application/ai/routing';
import { t } from '$lib/i18n';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const items = listItems({ items: itemsPort });
	const playbooks = playbooksPort.list();
	return {
		documents: inboxPort.listPending().map((document) => ({
			...document,
			suggestion: document.suggestion
				? restrictRoutingSuggestion(
						document.suggestion,
						playbooks.map((playbook) => playbook.id),
						items.map((item) => item.id)
					)
				: null
		})),
		items,
		playbooks,
		aiAvailable:
			getAiSettings({ settings: appSettingsPort }).enabled && config.aiCredentialConfigured
	};
};

export const actions: Actions = {
	upload: async ({ request }) => {
		let parsed: Awaited<ReturnType<typeof parseSingleFileForm>>;
		try {
			parsed = await parseSingleFileForm(request, {
				destDir: config.inboxTmpDir,
				maxFileBytes: MAX_ATTACHMENT_BYTES,
				maxFieldBytes: 16,
				maxFields: 0
			});
		} catch (cause) {
			return fail(400, {
				error:
					cause instanceof MultipartFileTooLargeError
						? t('inbox.error.fileTooLarge')
						: t('inbox.error.invalidUpload')
			});
		}
		if (!parsed.file) return fail(400, { error: t('inbox.error.fileRequired') });
		try {
			uploadInboxDocument(
				{ inbox: inboxPort, storage: inboxStoragePort, ids: idsPort, clock },
				{ filename: parsed.file.filename, bytes: fs.readFileSync(parsed.file.path) }
			);
		} catch (cause) {
			if (cause instanceof InboxDocumentRejectedError)
				return fail(400, { error: t('inbox.error.fileRejected') });
			return fail(400, { error: t('inbox.error.invalidUpload') });
		} finally {
			try {
				fs.rmSync(parsed.file.path, { force: true });
			} catch {
				// The temporary upload directory is isolated and cleaned on startup.
			}
		}
		redirect(303, '/inbox');
	},
	route: async ({ request }) => {
		const form = await request.formData();
		const documentId = String(form.get('documentId') ?? '');
		if (form.get('confirmed') !== 'yes')
			return fail(400, { error: t('inbox.error.confirmationRequired') });
		const destination = String(form.get('destination') ?? '');
		const itemId = String(form.get('itemId') ?? '');
		const title = String(form.get('title') ?? '');
		const playbookId = String(form.get('playbookId') ?? '');
		const input =
			destination === 'existing' && itemId
				? { documentId, destination: 'EXISTING' as const, itemId }
				: destination === 'new'
					? playbookId
						? { documentId, destination: 'PLAYBOOK' as const, newItemTitle: title, playbookId }
						: { documentId, destination: 'GENERIC' as const, newItemTitle: title }
					: null;
		if (!input) return fail(400, { error: t('inbox.error.invalidDestination') });
		let result: ReturnType<typeof routeInboxDocument>;
		try {
			result = routeInboxDocument(
				{
					inbox: inboxPort,
					storage: inboxStoragePort,
					attachmentStorage: attachmentStoragePort,
					ids: idsPort,
					clock,
					playbooks: playbooksPort
				},
				input
			);
		} catch (cause) {
			if (cause instanceof InboxDocumentNotAvailableError)
				return fail(409, {
					error: t('inbox.error.notAvailable')
				});
			return fail(400, {
				error: t('inbox.error.routeFailed')
			});
		}
		redirect(303, `/items/${result.itemId}#attachment-${result.attachmentId}`);
	},
	analyze: async ({ request }) => {
		const form = await request.formData();
		if (!getAiSettings({ settings: appSettingsPort }).enabled || !config.aiCredentialConfigured)
			return fail(400, { error: t('inbox.error.aiUnavailable') });
		try {
			await analyzeInboxDocument(
				{
					inbox: inboxPort,
					storage: inboxStoragePort,
					clock,
					items: itemsPort,
					playbooks: playbooksPort,
					provider: extractionProvider,
					settings: appSettingsPort,
					runs: inboxAiRunsPort,
					ids: idsPort
				},
				{
					documentId: String(form.get('documentId') ?? ''),
					timeoutMs: config.aiTimeoutMs,
					maxOutputTokens: config.aiMaxOutputTokens,
					maxDocumentBytes: config.aiMaxDocumentBytes,
					dailyLimit: config.aiDailyRunLimit
				}
			);
		} catch {
			return fail(400, { error: t('inbox.error.analysisFailed') });
		}
		redirect(303, '/inbox');
	},
	delete: async ({ request }) => {
		const form = await request.formData();
		try {
			deleteInboxDocument(
				{ inbox: inboxPort, storage: inboxStoragePort },
				String(form.get('documentId') ?? '')
			);
		} catch {
			return fail(400, { error: t('inbox.error.notAvailable') });
		}
		redirect(303, '/inbox');
	}
};
