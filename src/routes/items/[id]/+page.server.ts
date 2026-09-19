import fs from 'node:fs';
import { error, fail, redirect } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { config } from '$lib/server/config';
import { log } from '$lib/server/log';
import {
	AttachmentDisplayNameTooLongError,
	MAX_ATTACHMENT_BYTES
} from '$lib/domain/attachment/attachment';
import {
	MultipartFileTooLargeError,
	parseSingleFileForm
} from '$lib/server/http/parseSingleFileForm';
import {
	addManualAction,
	InvalidManualDueDateError,
	ManualActionLabelRequiredError
} from '$lib/application/actions/addManualAction';
import {
	CycleNotCompleteError,
	InvalidPlaybookSnapshotError,
	ItemHasNoPlaybookError,
	ItemIsArchivedError,
	startNextCycle
} from '$lib/application/cycles/startNextCycle';
import { getCycleHistory } from '$lib/application/cycles/getCycleHistory';
import { ItemNotFoundError, setItemArchived } from '$lib/application/items/setItemArchived';
import { isCycleComplete } from '$lib/domain/cycle/completion';
import { parsePlaybookSnapshot } from '$lib/domain/playbook/snapshot';
import { newerVersionAvailable } from '$lib/domain/playbook/version';
import type { Item } from '$lib/domain/item/item';
import { setActionState } from '$lib/application/actions/setActionState';
import {
	InvalidDueOverrideDateError,
	setActionDueOverride
} from '$lib/application/actions/setActionDueOverride';
import { addCustomField, FieldLabelRequiredError } from '$lib/application/items/addCustomField';
import { getItemDetail } from '$lib/application/items/getItemDetail';
import { getItemWorkflow } from '$lib/application/items/getItemWorkflow';
import { loadItemOverview } from '$lib/application/items/loadItemOverview';
import { loadItemHistory, countItemHistory } from '$lib/application/history/itemHistory';
import { HISTORY_PAGE_SIZE, resolveHistoryLimit } from '$lib/application/history/historyPagination';
import {
	InvalidItemRelationError,
	linkItems,
	listRelatedItems,
	normalizeCandidateQuery,
	searchRelationCandidates,
	unlinkItems
} from '$lib/application/items/itemRelations';
import { removeCustomField } from '$lib/application/items/removeCustomField';
import {
	InvalidCurrencyValueError,
	InvalidDateValueError,
	ItemHasNoActiveCycleError,
	UnknownFieldError,
	updateItemFields
} from '$lib/application/items/updateItemFields';
import { ActionNotMutableError } from '$lib/server/db/repositories/actionRepository';
import { CannotRemovePlaybookFieldError } from '$lib/server/db/repositories/fieldRepository';
import { ItemNotWritableError } from '$lib/server/db/repositories/writeGuards';
import {
	actionsPort,
	appSettingsPort,
	cyclesPort,
	eventsPort,
	extractionRunsPort,
	fieldsPort,
	itemsPort,
	scheduleRepositoryPort,
	attachmentsPort,
	attachmentStoragePort,
	idsPort,
	clock,
	itemsPort as attachmentItemsPort,
	playbooksPort,
	itemRelationsPort,
	itemHistoryPort
} from '$lib/server/appPorts';
import { recordHistoryEvent } from '$lib/application/history/itemHistory';
import {
	addAttachment,
	AttachmentRejectedError,
	AttachmentRenameRejectedError,
	renameAttachment,
	removeAttachment
} from '$lib/application/attachments/attachments';
import { getAiSettings } from '$lib/application/ai/aiSettings';
import {
	AttachmentRenameFormError,
	parseAttachmentRenameForm,
	submitAttachmentRenameForm
} from '$lib/server/http/attachmentRenameForm';
import type { Actions, PageServerLoad } from './$types';

const FIELD_PREFIX = 'field:';
/** A `currency` field submits its ISO 4217 code as a second form entry
 *  under this prefix (the amount stays under FIELD_PREFIX) — two plain
 *  inputs, no client-side JS combining them before submit. */
const FIELD_CURRENCY_PREFIX = 'fieldCurrency:';

/** True when the item's frozen playbook snapshot cannot drive a new cycle:
 *  either the stored JSON itself is corrupt, or it parses but fails the
 *  canonical playbook validation (reusing the same validator startNextCycle
 *  itself uses, so this can never disagree with the real guard — see the
 *  Slice 8 review, findings 3 and 4). An item with no playbook at all
 *  (playbookSnapshot === null, not corrupted) is not "invalid", just
 *  generic — it never had a snapshot to validate. */
function snapshotIsInvalid(item: Item): boolean {
	if (item.playbookSnapshotCorrupted) return true;
	if (item.playbookSnapshot === null) return false;
	return !parsePlaybookSnapshot(item.playbookSnapshot).ok;
}

export const load: PageServerLoad = ({ params, url }) => {
	const detail = getItemDetail(
		{ items: itemsPort, cycles: cyclesPort, fields: fieldsPort },
		params.id
	);
	if (!detail) error(404, 'Item not found');
	const workflow =
		getItemWorkflow(
			{ cycles: cyclesPort, actions: actionsPort, events: eventsPort, fields: fieldsPort },
			params.id
		) ?? [];
	// May import domain modules directly (route files are allowed to).
	const cycleComplete = isCycleComplete(workflow.map((w) => w.action));
	const history = getCycleHistory(
		{ cycles: cyclesPort, fields: fieldsPort, actions: actionsPort },
		params.id
	);
	const snapshotInvalid = snapshotIsInvalid(detail.item);
	const installedPlaybook = detail.item.playbookId
		? playbooksPort.findById(detail.item.playbookId)
		: null;
	const canStartNextCycle =
		cycleComplete &&
		detail.item.status === 'ACTIVE' &&
		detail.item.playbookSnapshot !== null &&
		!snapshotInvalid;

	// UI visibility only — every check here is re-done server-side in the
	// `extract` action, which is the actual enforcement boundary.
	const aiSettings = getAiSettings({ settings: appSettingsPort });
	const aiExtractionAvailable =
		aiSettings.enabled &&
		config.aiCredentialConfigured &&
		detail.item.status === 'ACTIVE' &&
		detail.cycle !== null;
	const pendingExtractionRun = detail.cycle
		? extractionRunsPort.findNewestPendingRun(detail.cycle.id)
		: null;
	const attachmentCycleSequences = Object.fromEntries(
		cyclesPort.listCycles(params.id).map((cycle) => [cycle.id, cycle.sequence])
	);
	const overview = loadItemOverview(
		{
			cycles: cyclesPort,
			actions: actionsPort,
			events: eventsPort,
			fields: fieldsPort,
			attachments: attachmentsPort,
			relations: itemRelationsPort
		},
		params.id
	);
	const relatedItems = listRelatedItems({ relations: itemRelationsPort }, params.id);
	const relationSearch =
		detail.item.status === 'ACTIVE'
			? searchRelationCandidates(
					{ relations: itemRelationsPort },
					params.id,
					url.searchParams.get('q') ?? ''
				)
			: { query: '', candidates: [] };

	const historyLimit = resolveHistoryLimit(url.searchParams.get('historyCount'));
	const historyEvents = loadItemHistory(
		{ history: itemHistoryPort },
		{ itemId: params.id, limit: historyLimit, offset: 0, fields: detail.fields }
	);
	const historyTotal = countItemHistory({ history: itemHistoryPort }, params.id);

	return {
		item: detail.item,
		fields: detail.fields,
		workflow,
		attachments: attachmentsPort.listByItem(params.id),
		attachmentCycleSequences,
		overview,
		relatedItems,
		relationCandidates: relationSearch.candidates,
		relationQuery: relationSearch.query,
		relationsManage: url.searchParams.get('manage') === 'relations',
		cycleComplete,
		history,
		historyEvents,
		historyTotal,
		historyLimit,
		historyPageSize: HISTORY_PAGE_SIZE,
		canStartNextCycle,
		snapshotInvalid,
		aiExtractionAvailable,
		aiMaxDocumentBytes: config.aiMaxDocumentBytes,
		pendingExtractionRun,
		newerPlaybookVersion:
			installedPlaybook &&
			newerVersionAvailable(detail.item.playbookVersion, installedPlaybook.version)
				? installedPlaybook.version
				: null
	};
};

/** Every mutating action guards on this: the UI hides the forms for an
 *  archived item, but the server must not rely on that (see the cycles
 *  ADR's Security section). */
function isItemArchived(itemId: string): boolean {
	return itemsPort.getItemById(itemId)?.status === 'ARCHIVED';
}

export const actions: Actions = {
	linkItem: async ({ request, params }) => {
		const data = await request.formData();
		const relatedItemId = String(data.get('relatedItemId') ?? '');
		const query = String(data.get('q') ?? '');
		try {
			linkItems({ relations: itemRelationsPort, clock }, { itemId: params.id, relatedItemId });
		} catch (cause) {
			if (cause instanceof InvalidItemRelationError) {
				const key =
					cause.reason === 'ARCHIVED_ITEM'
						? 'items.detail.archivedReadOnly'
						: cause.reason === 'DUPLICATE'
							? 'items.detail.relationsDuplicate'
							: 'items.detail.relationsInvalid';
				return fail(400, { error: t(key) });
			}
			throw cause;
		}
		recordHistoryEvent(
			{ history: itemHistoryPort, ids: idsPort, clock },
			{
				itemId: params.id,
				actorKind: 'OWNER',
				eventType: 'RELATION_LINKED',
				payload: { relatedItemId }
			}
		);
		redirect(303, relationRedirect(params.id, query));
	},
	unlinkItem: async ({ request, params }) => {
		const data = await request.formData();
		const relatedItemId = String(data.get('relatedItemId') ?? '');
		const query = String(data.get('q') ?? '');
		try {
			unlinkItems({ relations: itemRelationsPort }, { itemId: params.id, relatedItemId });
		} catch (cause) {
			if (cause instanceof InvalidItemRelationError) {
				return fail(400, { error: t('items.detail.relationsInvalid') });
			}
			throw cause;
		}
		recordHistoryEvent(
			{ history: itemHistoryPort, ids: idsPort, clock },
			{
				itemId: params.id,
				actorKind: 'OWNER',
				eventType: 'RELATION_UNLINKED',
				payload: { relatedItemId }
			}
		);
		redirect(
			303,
			itemRelationsPort.countRelated(params.id) === 0
				? `/items/${params.id}#relations`
				: relationRedirect(params.id, query)
		);
	},
	addAttachment: async ({ request, params }) => {
		if (isItemArchived(params.id)) return fail(400, { error: t('items.detail.archivedReadOnly') });
		// Streams the upload straight to a temp file under attachmentsTmpDir
		// (the same directory `store()` already uses, so the startup
		// `.part`-file sweep also covers a request that never finishes)
		// instead of buffering the whole file in memory via
		// `await request.formData()` / `file.arrayBuffer()`. maxFileBytes
		// matches MAX_ATTACHMENT_BYTES exactly, so an oversized upload is
		// rejected mid-stream.
		let parsed: Awaited<ReturnType<typeof parseSingleFileForm>>;
		try {
			parsed = await parseSingleFileForm(request, {
				destDir: config.attachmentsTmpDir,
				maxFileBytes: MAX_ATTACHMENT_BYTES,
				maxFieldBytes: 16,
				maxFields: 0
			});
		} catch (cause) {
			const key =
				cause instanceof MultipartFileTooLargeError ? 'attachmentTooLarge' : 'attachmentEmpty';
			return fail(400, { error: t(key) });
		}
		if (!parsed.file) return fail(400, { error: t('attachmentEmpty') });
		try {
			const added = addAttachment(
				{
					items: attachmentItemsPort,
					cycles: cyclesPort,
					attachments: attachmentsPort,
					storage: attachmentStoragePort,
					ids: idsPort,
					clock
				},
				{
					itemId: params.id,
					filename: parsed.file.filename,
					bytes: new Uint8Array(fs.readFileSync(parsed.file.path))
				}
			);
			recordHistoryEvent(
				{ history: itemHistoryPort, ids: idsPort, clock },
				{
					itemId: params.id,
					actorKind: 'OWNER',
					eventType: 'ATTACHMENT_ADDED',
					payload: { attachmentId: added.id }
				}
			);
			redirect(303, `/items/${params.id}#attachment-${added.id}`);
		} catch (e) {
			if (e instanceof ItemNotWritableError) {
				// The item was archived by a concurrent request while this
				// upload was still streaming — the early isItemArchived() check
				// above already passed. See the Slice 8 review, finding 2.
				return fail(400, { error: t('items.detail.archivedReadOnly') });
			}
			if (e instanceof AttachmentRejectedError) {
				// Preserve the specific outcome instead of collapsing every
				// rejection reason into one generic message. ITEM_NOT_FOUND is a
				// real 404 (only reachable via a stale or crafted request, since
				// the page load already 404s for a missing item), not a form
				// notice on a page for an item that does not exist.
				if (e.message === 'ITEM_NOT_FOUND') error(404, 'Item not found');
				const key =
					e.message === 'EMPTY'
						? 'attachmentEmpty'
						: e.message === 'TOO_LARGE'
							? 'attachmentTooLarge'
							: e.message === 'LIMIT'
								? 'attachmentLimitReached'
								: e.message === 'TYPE'
									? 'attachmentTypeNotAllowed'
									: 'attachmentFailed';
				return fail(400, { error: t(key) });
			}
			throw e;
		} finally {
			// addAttachment() (on success) copies the bytes into their own
			// permanent storage path via storage.store(); the streamed upload
			// file was only ever scratch input and must not linger either way.
			fs.rmSync(parsed.file.path, { force: true });
		}
	},
	removeAttachment: async ({ request, params }) => {
		if (isItemArchived(params.id)) return fail(400, { error: t('items.detail.archivedReadOnly') });
		const data = await request.formData();
		const removeId = String(data.get('removeAttachmentId') ?? data.get('attachmentId') ?? '');
		try {
			removeAttachment(
				{ attachments: attachmentsPort, storage: attachmentStoragePort },
				params.id,
				removeId
			);
		} catch (err) {
			if (err instanceof ItemNotWritableError) {
				return fail(400, { error: t('items.detail.archivedReadOnly') });
			}
			throw err;
		}
		recordHistoryEvent(
			{ history: itemHistoryPort, ids: idsPort, clock },
			{
				itemId: params.id,
				actorKind: 'OWNER',
				eventType: 'ATTACHMENT_REMOVED',
				payload: { attachmentId: removeId }
			}
		);
		redirect(303, `/items/${params.id}`);
	},
	manageAttachments: async ({ request, params }) => {
		if (isItemArchived(params.id)) return fail(400, { error: t('items.detail.archivedReadOnly') });
		const data = await request.formData();
		try {
			const entries = parseAttachmentRenameForm(data);
			submitAttachmentRenameForm(attachmentsPort.listByItem(params.id), entries, (entry) =>
				renameAttachment(
					{ items: attachmentItemsPort, attachments: attachmentsPort },
					{ itemId: params.id, ...entry }
				)
			);
		} catch (err) {
			if (err instanceof AttachmentDisplayNameTooLongError) {
				return fail(400, { error: t('items.detail.attachmentDisplayNameTooLong') });
			}
			if (
				err instanceof AttachmentRenameRejectedError ||
				err instanceof AttachmentRenameFormError
			) {
				return fail(400, {
					error:
						err.message === 'ITEM_NOT_WRITABLE'
							? t('items.detail.archivedReadOnly')
							: t('items.detail.attachmentManageInvalid')
				});
			}
			if (err instanceof ItemNotWritableError) {
				return fail(400, { error: t('items.detail.archivedReadOnly') });
			}
			log.error('attachment display-name update failed');
			return fail(400, { error: t('items.detail.attachmentRenameFailed') });
		}
		redirect(303, `/items/${params.id}#attachments-label`);
	},
	updateFields: async ({ request, params }) => {
		if (isItemArchived(params.id)) return fail(400, { error: t('items.detail.archivedReadOnly') });
		const formData = await request.formData();
		const updates = [...formData.entries()]
			.filter(([key]) => key.startsWith(FIELD_PREFIX))
			.map(([key, value]) => {
				const fieldKey = key.slice(FIELD_PREFIX.length);
				return {
					fieldKey,
					value: value.toString(),
					currencyCode: formData.get(`${FIELD_CURRENCY_PREFIX}${fieldKey}`)?.toString()
				};
			});

		// Snapshotted before the write so a `FIELD_CHANGED` event can be
		// recorded only for a field whose stored value actually differs —
		// re-submitting the form unchanged (every populated field re-posts
		// its current value) must not log one event per field.
		const activeCycleBefore = cyclesPort.getActiveCycle(params.id);
		const valuesBefore = new Map(
			activeCycleBefore
				? fieldsPort.listFields(activeCycleBefore.id).map((f) => [f.fieldKey, f.value])
				: []
		);

		try {
			updateItemFields(
				{ cycles: cyclesPort, fields: fieldsPort, schedule: scheduleRepositoryPort },
				{ itemId: params.id, updates }
			);
		} catch (err) {
			if (err instanceof ItemNotWritableError) {
				return fail(400, { error: t('items.detail.archivedReadOnly') });
			}
			if (
				err instanceof UnknownFieldError ||
				err instanceof InvalidDateValueError ||
				err instanceof InvalidCurrencyValueError ||
				err instanceof ItemHasNoActiveCycleError
			) {
				return fail(400, { error: err.message });
			}
			throw err;
		}

		const updatedFieldKeys = new Set(updates.map((u) => u.fieldKey));
		const fieldsAfter = fieldsPort.listFields(cyclesPort.getActiveCycle(params.id)?.id ?? '');
		for (const field of fieldsAfter) {
			if (!updatedFieldKeys.has(field.fieldKey)) continue;
			if ((valuesBefore.get(field.fieldKey) ?? null) === field.value) continue;
			recordHistoryEvent(
				{ history: itemHistoryPort, ids: idsPort, clock },
				{
					itemId: params.id,
					actorKind: 'OWNER',
					eventType: 'FIELD_CHANGED',
					payload: { fieldKey: field.fieldKey }
				}
			);
		}

		// Redirect back to the clean item URL: without this, the browser's
		// address bar (and any bookmark) would permanently carry the
		// `?/updateFields` action-query suffix from this POST, since this
		// route deliberately has no client-side `use:enhance` (forms must
		// keep working with JavaScript disabled).
		redirect(303, `/items/${params.id}`);
	},

	addField: async ({ request, params }) => {
		if (isItemArchived(params.id)) return fail(400, { error: t('items.detail.archivedReadOnly') });
		const formData = await request.formData();
		const label = formData.get('label')?.toString() ?? '';
		const rawType = formData.get('type')?.toString();
		const type = rawType === 'date' || rawType === 'currency' ? rawType : 'text';

		let field;
		try {
			field = addCustomField(
				{ cycles: cyclesPort, fields: fieldsPort },
				{ itemId: params.id, label, type }
			);
		} catch (err) {
			if (err instanceof ItemNotWritableError) {
				return fail(400, { error: t('items.detail.archivedReadOnly') });
			}
			if (err instanceof FieldLabelRequiredError || err instanceof ItemHasNoActiveCycleError) {
				return fail(400, { error: err.message });
			}
			throw err;
		}

		recordHistoryEvent(
			{ history: itemHistoryPort, ids: idsPort, clock },
			{
				itemId: params.id,
				actorKind: 'OWNER',
				eventType: 'CUSTOM_FIELD_ADDED',
				payload: { fieldKey: field.fieldKey }
			}
		);

		// Land back on the field the user just created (see FieldInput's
		// anchor id and :target highlight in app.css) so it is obvious
		// where it went, instead of leaving them to scan the whole list.
		redirect(303, `/items/${params.id}#field-${field.fieldKey}`);
	},

	removeField: async ({ request, params }) => {
		if (isItemArchived(params.id)) return fail(400, { error: t('items.detail.archivedReadOnly') });
		const formData = await request.formData();
		const fieldKey = formData.get('fieldKey')?.toString() ?? '';

		try {
			removeCustomField(
				{ cycles: cyclesPort, fields: fieldsPort },
				{ itemId: params.id, fieldKey }
			);
		} catch (err) {
			if (err instanceof ItemNotWritableError) {
				return fail(400, { error: t('items.detail.archivedReadOnly') });
			}
			if (
				err instanceof CannotRemovePlaybookFieldError ||
				err instanceof ItemHasNoActiveCycleError
			) {
				return fail(400, { error: err.message });
			}
			throw err;
		}

		recordHistoryEvent(
			{ history: itemHistoryPort, ids: idsPort, clock },
			{
				itemId: params.id,
				actorKind: 'OWNER',
				eventType: 'CUSTOM_FIELD_REMOVED',
				payload: { fieldKey }
			}
		);

		redirect(303, `/items/${params.id}`);
	},

	addManualAction: async ({ request, params }) => {
		if (isItemArchived(params.id)) return fail(400, { error: t('items.detail.archivedReadOnly') });
		const formData = await request.formData();
		const label = formData.get('label')?.toString() ?? '';
		const dueDate = formData.get('dueDate')?.toString() || null;

		try {
			addManualAction(
				{ cycles: cyclesPort, actions: actionsPort },
				{ itemId: params.id, label, dueDate }
			);
		} catch (err) {
			if (err instanceof ItemNotWritableError) {
				return fail(400, { error: t('items.detail.archivedReadOnly') });
			}
			if (
				err instanceof ManualActionLabelRequiredError ||
				err instanceof InvalidManualDueDateError ||
				err instanceof ItemHasNoActiveCycleError
			) {
				return fail(400, { error: err.message });
			}
			throw err;
		}

		recordHistoryEvent(
			{ history: itemHistoryPort, ids: idsPort, clock },
			{ itemId: params.id, actorKind: 'OWNER', eventType: 'ACTION_ADDED', payload: {} }
		);

		redirect(303, `/items/${params.id}`);
	},

	completeAction: async ({ request, params }) => transitionAction(request, params.id, 'DONE'),
	skipAction: async ({ request, params }) => transitionAction(request, params.id, 'SKIPPED'),

	setActionDueOverride: async ({ request, params }) => {
		if (isItemArchived(params.id)) return fail(400, { error: t('items.detail.archivedReadOnly') });
		const formData = await request.formData();
		const actionId = formData.get('actionId')?.toString();
		if (!actionId) return fail(400, { error: 'missing actionId' });
		const dueDate = formData.get('dueDate')?.toString() ?? null;

		try {
			setActionDueOverride({ actions: actionsPort }, { itemId: params.id, actionId, dueDate });
		} catch (err) {
			if (err instanceof InvalidDueOverrideDateError) {
				return fail(400, { error: err.message });
			}
			if (err instanceof ActionNotMutableError) {
				return fail(400, { error: t('items.detail.actionNotMutable') });
			}
			throw err;
		}

		recordHistoryEvent(
			{ history: itemHistoryPort, ids: idsPort, clock },
			{
				itemId: params.id,
				actorKind: 'OWNER',
				eventType: 'ACTION_DUE_OVERRIDE_SET',
				payload: { actionId }
			}
		);

		redirect(303, `/items/${params.id}`);
	},

	resetActionDueOverride: async ({ request, params }) => {
		if (isItemArchived(params.id)) return fail(400, { error: t('items.detail.archivedReadOnly') });
		const formData = await request.formData();
		const actionId = formData.get('actionId')?.toString();
		if (!actionId) return fail(400, { error: 'missing actionId' });

		try {
			setActionDueOverride(
				{ actions: actionsPort },
				{ itemId: params.id, actionId, dueDate: null }
			);
		} catch (err) {
			if (err instanceof ActionNotMutableError) {
				return fail(400, { error: t('items.detail.actionNotMutable') });
			}
			throw err;
		}

		recordHistoryEvent(
			{ history: itemHistoryPort, ids: idsPort, clock },
			{
				itemId: params.id,
				actorKind: 'OWNER',
				eventType: 'ACTION_DUE_OVERRIDE_CLEARED',
				payload: { actionId }
			}
		);

		redirect(303, `/items/${params.id}`);
	},

	startNextCycle: async ({ params }) => {
		try {
			const newCycle = startNextCycle(
				{ items: itemsPort, cycles: cyclesPort, fields: fieldsPort, actions: actionsPort },
				{ itemId: params.id }
			);
			recordHistoryEvent(
				{ history: itemHistoryPort, ids: idsPort, clock },
				{
					itemId: params.id,
					actorKind: 'OWNER',
					eventType: 'CYCLE_STARTED',
					payload: { cycleId: newCycle.id, sequence: newCycle.sequence }
				}
			);
		} catch (err) {
			if (err instanceof ItemIsArchivedError) {
				return fail(400, { error: t('items.detail.archivedReadOnly') });
			}
			if (err instanceof CycleNotCompleteError) {
				return fail(400, { error: t('items.detail.cycleNotComplete') });
			}
			if (err instanceof ItemHasNoPlaybookError) {
				return fail(400, { error: t('items.detail.noPlaybookNoCycle') });
			}
			if (err instanceof InvalidPlaybookSnapshotError) {
				// Bounded metadata only: itemId, a fixed code, and validation
				// PATHS (never messages or values — some Zod messages embed the
				// actual rejected value, e.g. an enum mismatch). See the Slice 8
				// review, finding 5.
				log.warn('playbook snapshot invalid', {
					itemId: params.id,
					code: 'INVALID_SNAPSHOT',
					paths: err.issues.map((i) => i.path)
				});
				return fail(400, { error: t('items.detail.snapshotInvalid') });
			}
			if (err instanceof ItemHasNoActiveCycleError) error(404, 'Item not found');
			throw err;
		}
		redirect(303, `/items/${params.id}#fields-label`);
	},

	archiveItem: async ({ params }) => {
		try {
			setItemArchived({ items: itemsPort }, { itemId: params.id, archived: true });
		} catch (err) {
			if (err instanceof ItemNotFoundError) error(404, 'Item not found');
			throw err;
		}
		recordHistoryEvent(
			{ history: itemHistoryPort, ids: idsPort, clock },
			{ itemId: params.id, actorKind: 'OWNER', eventType: 'ITEM_ARCHIVED', payload: {} }
		);
		redirect(303, `/items/${params.id}`);
	},

	unarchiveItem: async ({ params }) => {
		try {
			setItemArchived({ items: itemsPort }, { itemId: params.id, archived: false });
		} catch (err) {
			if (err instanceof ItemNotFoundError) error(404, 'Item not found');
			throw err;
		}
		recordHistoryEvent(
			{ history: itemHistoryPort, ids: idsPort, clock },
			{ itemId: params.id, actorKind: 'OWNER', eventType: 'ITEM_UNARCHIVED', payload: {} }
		);
		redirect(303, `/items/${params.id}`);
	}
};

function relationRedirect(itemId: string, query: string): string {
	const params = new URLSearchParams({ manage: 'relations' });
	const normalizedQuery = normalizeCandidateQuery(query);
	if (normalizedQuery) params.set('q', normalizedQuery);
	return `/items/${itemId}?${params.toString()}#relations`;
}

async function transitionAction(request: Request, itemId: string, newState: 'DONE' | 'SKIPPED') {
	if (isItemArchived(itemId)) return fail(400, { error: t('items.detail.archivedReadOnly') });
	const formData = await request.formData();
	const actionId = formData.get('actionId')?.toString();
	if (!actionId) return fail(400, { error: 'missing actionId' });

	try {
		setActionState({ actions: actionsPort }, { itemId, actionId, newState });
	} catch (err) {
		if (err instanceof ActionNotMutableError) {
			// Deliberately one message regardless of cause (wrong item,
			// archived item, inactive cycle, stale id, invalid transition) —
			// see the Slice 8 review, finding 1.
			return fail(400, { error: t('items.detail.actionNotMutable') });
		}
		throw err;
	}

	recordHistoryEvent(
		{ history: itemHistoryPort, ids: idsPort, clock },
		{
			itemId,
			actorKind: 'OWNER',
			eventType: newState === 'DONE' ? 'ACTION_COMPLETED' : 'ACTION_SKIPPED',
			payload: { actionId }
		}
	);

	redirect(303, `/items/${itemId}`);
}
