import { error, fail, redirect } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import {
	AttachmentDisplayNameTooLongError,
	attachmentDisplayName
} from '$lib/domain/attachment/attachment';
import {
	AttachmentRenameRejectedError,
	getAttachmentForItem,
	removeAttachment,
	renameAttachment
} from '$lib/application/attachments/attachments';
import {
	appSettingsPort,
	attachmentReadPort,
	attachmentStoragePort,
	attachmentsPort,
	clock,
	cyclesPort,
	extractionProvider,
	extractionRunsPort,
	fieldsPort,
	idsPort,
	itemsPort
} from '$lib/server/appPorts';
import { ItemNotWritableError } from '$lib/server/db/repositories/writeGuards';
import { config } from '$lib/server/config';
import { getAiSettings } from '$lib/application/ai/aiSettings';
import {
	extractFromDocument,
	ExtractionNotAllowedError
} from '$lib/application/ai/extractFromDocument';
import {
	ExtractionFailedError,
	ExtractionMalformedOutputError,
	ExtractionTimeoutError,
	ExtractionUnavailableError
} from '$lib/application/ai/extraction';
import type { Actions, PageServerLoad } from './$types';

function loadAttachment(itemId: string, attachmentId: string) {
	const attachment = getAttachmentForItem(
		{ items: itemsPort, attachments: attachmentsPort },
		itemId,
		attachmentId
	);
	if (!attachment) error(404, 'Attachment not found');
	return attachment;
}

export const load: PageServerLoad = ({ params, locals }) => {
	if (!locals.user) error(403);
	const item = itemsPort.getItemById(params.id);
	const attachment = loadAttachment(params.id, params.attachmentId);
	if (!item) error(404, 'Item not found');
	const aiSettings = getAiSettings({ settings: appSettingsPort });
	const aiExtractionAvailable =
		aiSettings.enabled &&
		config.aiCredentialConfigured &&
		item.status === 'ACTIVE' &&
		cyclesPort.getActiveCycle(item.id) !== null;
	const cycleSequence = attachment.cycleId
		? (cyclesPort.listCycles(item.id).find((cycle) => cycle.id === attachment.cycleId)?.sequence ??
			null)
		: null;
	return {
		item,
		attachment,
		displayName: attachmentDisplayName(attachment),
		cycleSequence,
		aiExtractionAvailable,
		aiMaxDocumentBytes: config.aiMaxDocumentBytes
	};
};

export const actions: Actions = {
	rename: async ({ request, params, locals }) => {
		if (!locals.user) error(403);
		const data = await request.formData();
		try {
			renameAttachment(
				{ items: itemsPort, attachments: attachmentsPort },
				{
					itemId: params.id,
					attachmentId: params.attachmentId,
					displayName: String(data.get('displayName') ?? '')
				}
			);
		} catch (cause) {
			if (cause instanceof AttachmentDisplayNameTooLongError) {
				return fail(400, { error: t('items.detail.attachmentDisplayNameTooLong') });
			}
			if (cause instanceof AttachmentRenameRejectedError || cause instanceof ItemNotWritableError) {
				return fail(400, { error: t('items.detail.archivedReadOnly') });
			}
			return fail(400, { error: t('items.detail.attachmentRenameFailed') });
		}
		redirect(303, `/items/${params.id}/attachments/${params.attachmentId}`);
	},
	remove: async ({ params, locals }) => {
		if (!locals.user) error(403);
		try {
			removeAttachment(
				{ attachments: attachmentsPort, storage: attachmentStoragePort },
				params.id,
				params.attachmentId
			);
		} catch (cause) {
			if (cause instanceof ItemNotWritableError) {
				return fail(400, { error: t('items.detail.archivedReadOnly') });
			}
			throw cause;
		}
		redirect(303, `/items/${params.id}#attachments-label`);
	},
	extract: async ({ params, locals }) => {
		if (!locals.user) error(403);
		let runId: string;
		try {
			({ runId } = await extractFromDocument(
				{
					items: itemsPort,
					cycles: cyclesPort,
					fields: fieldsPort,
					attachments: attachmentsPort,
					attachmentBytes: attachmentReadPort,
					settings: appSettingsPort,
					runs: extractionRunsPort,
					provider: extractionProvider,
					ids: idsPort,
					clock
				},
				{ itemId: params.id, attachmentId: params.attachmentId },
				{
					hasApiKey: config.aiCredentialConfigured,
					maxDocumentBytes: config.aiMaxDocumentBytes,
					timeoutMs: config.aiTimeoutMs,
					maxOutputTokens: config.aiMaxOutputTokens,
					dailyLimit: config.aiDailyRunLimit
				}
			));
		} catch (cause) {
			if (cause instanceof ExtractionNotAllowedError) {
				if (cause.reason === 'ATTACHMENT_NOT_FOUND') error(404, 'Attachment not found');
				const key =
					cause.reason === 'DISABLED'
						? 'ai.error.disabled'
						: cause.reason === 'NOT_CONFIGURED'
							? 'ai.error.notConfigured'
							: cause.reason === 'UNSUPPORTED_TYPE'
								? 'ai.error.unsupportedType'
								: cause.reason === 'TOO_LARGE'
									? 'ai.error.tooLarge'
									: cause.reason === 'DAILY_LIMIT'
										? 'ai.error.rateLimited'
										: 'items.detail.archivedReadOnly';
				return fail(400, { error: t(key) });
			}
			if (cause instanceof ExtractionUnavailableError) {
				return fail(400, { error: t('ai.error.notConfigured') });
			}
			if (
				cause instanceof ExtractionTimeoutError ||
				cause instanceof ExtractionFailedError ||
				cause instanceof ExtractionMalformedOutputError
			) {
				return fail(400, { error: t('ai.error.failed') });
			}
			throw cause;
		}
		redirect(303, `/items/${params.id}/suggestions/${runId}`);
	}
};
