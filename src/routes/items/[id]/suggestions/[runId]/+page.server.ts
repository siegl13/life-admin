import { error, fail, redirect } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { getExtractionRun } from '$lib/application/ai/getExtractionRun';
import {
	applyExtractionRun,
	ExtractionRunNotFoundError,
	UnknownFieldError,
	InvalidDateValueError
} from '$lib/application/ai/applyExtractionRun';
import { dismissExtractionRun } from '$lib/application/ai/dismissExtractionRun';
import {
	addAdditionalFieldsFromRun,
	FieldLabelRequiredError,
	InvalidCurrencyValueError
} from '$lib/application/ai/addAdditionalFieldsFromRun';
import {
	AdditionalSuggestionNotFoundError,
	ExtractionRunNotReviewableError
} from '$lib/application/ai/ports';
import type { FieldType } from '$lib/domain/field/field';
import { ItemNotWritableError } from '$lib/server/db/repositories/writeGuards';
import { recordHistoryEvent } from '$lib/application/history/itemHistory';
import {
	attachmentsPort,
	clock,
	extractionRunsPort,
	fieldsPort,
	idsPort,
	itemHistoryPort,
	itemsPort
} from '$lib/server/appPorts';
import type { Actions, PageServerLoad } from './$types';

const ACCEPT_PREFIX = 'accept:';
const ADD_PREFIX = 'add:';
const SUPPORTED_ADDITIONAL_TYPES: readonly FieldType[] = ['text', 'date', 'currency'];

export const load: PageServerLoad = ({ params }) => {
	const detail = getExtractionRun(
		{ runs: extractionRunsPort, fields: fieldsPort },
		{ itemId: params.id, runId: params.runId }
	);
	if (!detail) error(404, 'Suggestion run not found');
	const item = itemsPort.getItemById(params.id);
	if (!item) error(404, 'Item not found');

	// Re-resolved locally, never trusted from the run row alone. `attachmentId`
	// is legitimately null once the source attachment has been deleted (the
	// FK is ON DELETE SET NULL, not CASCADE, precisely so the run and its
	// daily-cap count survive — see review round-02 finding 1); the review
	// page still always names the document, either by filename or as no
	// longer available. A *non-null* id that fails to resolve to a row owned
	// by this item is a different, data-integrity condition (a crafted or
	// otherwise inconsistent run) and is treated as not found, matching every
	// other cross-item ownership guard in this codebase (round-02 finding 4).
	const attachment = detail.run.attachmentId
		? attachmentsPort.getById(detail.run.attachmentId)
		: null;
	if (detail.run.attachmentId && (!attachment || attachment.itemId !== params.id)) {
		error(404, 'Suggestion run not found');
	}
	const attachmentFilename = detail.run.sourceFilename || attachment?.filename || null;

	return {
		itemId: params.id,
		itemTitle: item.title,
		run: detail.run,
		attachmentFilename,
		suggestions: detail.suggestions,
		additionalSuggestions: detail.additionalSuggestions
	};
};

function handleApplyActionError(err: unknown) {
	if (err instanceof ExtractionRunNotFoundError) error(404, 'Suggestion run not found');
	if (
		err instanceof ExtractionRunNotReviewableError ||
		err instanceof AdditionalSuggestionNotFoundError
	) {
		return fail(400, { error: t('ai.error.failed') });
	}
	if (err instanceof ItemNotWritableError) {
		// The item was archived by a concurrent request while this run was
		// pending review — mirrors the same race already handled on the
		// item detail page's own addAttachment action.
		return fail(400, { error: t('items.detail.archivedReadOnly') });
	}
	if (
		err instanceof UnknownFieldError ||
		err instanceof InvalidDateValueError ||
		err instanceof InvalidCurrencyValueError ||
		err instanceof FieldLabelRequiredError
	) {
		return fail(400, { error: err.message });
	}
	throw err;
}

export const actions: Actions = {
	// One form, one submit: both sections (known-field suggestions and
	// additional suggestions) live in the same <form> now, so ticking boxes
	// in both and pressing either button applies both — a prior version had
	// each section as its own <form>/action, so only whichever button was
	// actually clicked took effect and the other section's checked boxes
	// were silently dropped. `addAdditional` runs first: it requires the run
	// to still be NEW, a precondition the known-field apply below ends by
	// design (NEW -> APPLIED).
	apply: async ({ request, params }) => {
		const formData = await request.formData();
		const acceptedFieldKeys = [...formData.keys()]
			.filter((key) => key.startsWith(ACCEPT_PREFIX))
			.map((key) => key.slice(ACCEPT_PREFIX.length));
		const additionalSelections = [...formData.keys()]
			.filter((key) => key.startsWith(ADD_PREFIX))
			.map((key) => key.slice(ADD_PREFIX.length))
			.map((suggestionId) => {
				const rawType = formData.get(`type:${suggestionId}`)?.toString();
				const type = (
					SUPPORTED_ADDITIONAL_TYPES.includes(rawType as FieldType) ? rawType : 'text'
				) as FieldType;
				return {
					suggestionId,
					label: formData.get(`label:${suggestionId}`)?.toString() ?? '',
					type,
					value: formData.get(`value:${suggestionId}`)?.toString() ?? '',
					currencyCode: formData.get(`currency:${suggestionId}`)?.toString()
				};
			});

		function recordAccepted(acceptedCount: number) {
			if (acceptedCount === 0) return;
			recordHistoryEvent(
				{ history: itemHistoryPort, ids: idsPort, clock },
				{
					itemId: params.id,
					actorKind: 'OWNER',
					eventType: 'AI_SUGGESTIONS_ACCEPTED',
					payload: { acceptedCount }
				}
			);
		}

		// `addAdditionalFieldsFromRun` and `applyExtractionRun` each commit in
		// their own independent DB transaction (see extractionRepository.ts).
		// Each gets its own try/catch and records its own event right after
		// its commit — recording once at the very end, after both calls,
		// would leave a durably-committed additional-field write with no
		// history event at all if the second call then threw (see review
		// round-02 finding 2).
		if (additionalSelections.length > 0) {
			let addedCount: number;
			try {
				addedCount = addAdditionalFieldsFromRun(
					{ runs: extractionRunsPort },
					{ itemId: params.id, runId: params.runId, selections: additionalSelections }
				).addedCount;
			} catch (err) {
				return handleApplyActionError(err);
			}
			recordAccepted(addedCount);
		}

		let acceptedCount: number;
		try {
			acceptedCount = applyExtractionRun(
				{ runs: extractionRunsPort, fields: fieldsPort, clock },
				{ itemId: params.id, runId: params.runId, acceptedFieldKeys }
			).acceptedCount;
		} catch (err) {
			return handleApplyActionError(err);
		}
		recordAccepted(acceptedCount);

		redirect(303, `/items/${params.id}`);
	},

	dismiss: async ({ params }) => {
		try {
			dismissExtractionRun(
				{ runs: extractionRunsPort, clock },
				{ itemId: params.id, runId: params.runId }
			);
		} catch (err) {
			if (err instanceof ExtractionRunNotFoundError) error(404, 'Suggestion run not found');
			if (err instanceof ExtractionRunNotReviewableError) {
				return fail(400, { error: t('ai.error.failed') });
			}
			throw err;
		}

		redirect(303, `/items/${params.id}`);
	}
};
