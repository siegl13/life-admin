import {
	AttachmentReadLimitError,
	type AttachmentMimeType
} from '../../domain/attachment/attachment';
import type {
	ActionRepositoryPort,
	AttachmentRepositoryPort,
	Clock,
	CycleRepositoryPort,
	FieldRepositoryPort,
	IdGeneratorPort,
	ItemRepositoryPort
} from '../ports';
import {
	ExtractionFailedError,
	ExtractionMalformedOutputError,
	ExtractionRateLimitError,
	ExtractionTimeoutError,
	ExtractionUnavailableError,
	type DocumentExtractionProviderPort
} from './extraction';
import type {
	AppSettingsPort,
	AttachmentReadPort,
	ExtractionRunRepositoryPort,
	MarkExtractionRunSucceededInput
} from './ports';
import { DailyExtractionLimitReachedError } from './ports';
import { getAiSettings } from './aiSettings';
import { buildExtractionContract } from './extractionContract';
import { filterSuggestions } from './filterSuggestions';
import { filterAdditionalSuggestions } from './filterAdditionalSuggestions';
import { filterActionSuggestions } from './filterActionSuggestions';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
/** Bounds the Item context sent to the provider for duplicate prevention. */
const MAX_EXISTING_ACTION_TITLES = 50;
const MAX_EXISTING_ACTION_TITLE_LENGTH = 120;

/** One reason per rejection, kept distinguishable server-side (each maps
 *  to its own i18n key at the route) but never exposed as provider or
 *  database detail. */
export type ExtractionNotAllowedReason =
	| 'DISABLED'
	| 'NOT_CONFIGURED'
	| 'ITEM_NOT_ACTIVE'
	| 'ATTACHMENT_NOT_FOUND'
	| 'UNSUPPORTED_TYPE'
	| 'TOO_LARGE'
	| 'DAILY_LIMIT';

export class ExtractionNotAllowedError extends Error {
	constructor(public readonly reason: ExtractionNotAllowedReason) {
		super(reason);
		this.name = 'ExtractionNotAllowedError';
	}
}

const SUPPORTED_MIME_TYPES: readonly AttachmentMimeType[] = [
	'application/pdf',
	'image/jpeg',
	'image/png',
	'image/webp'
];

export interface ExtractFromDocumentInput {
	itemId: string;
	attachmentId: string;
}

/** Operator/env-driven bounds — passed in by the route from `config.ts`
 *  rather than read here, so this use case stays independent of the
 *  environment (see the application/server ESLint boundary). */
export interface ExtractFromDocumentBounds {
	hasApiKey: boolean;
	maxDocumentBytes: number;
	timeoutMs: number;
	maxOutputTokens: number;
	dailyLimit: number;
}

/**
 * Checks enabled/key/ACTIVE item/ACTIVE cycle/attachment ownership/MIME/
 * size/daily cap, claims a RUNNING run (before any outbound call), calls
 * the provider, filters the result, and persists it as NEW (or FAILED on
 * error) — the first async use case in the codebase (see Slice 9's
 * "Named cost of the async boundary").
 */
export async function extractFromDocument(
	ports: {
		items: ItemRepositoryPort;
		cycles: CycleRepositoryPort;
		fields: FieldRepositoryPort;
		actions: ActionRepositoryPort;
		attachments: AttachmentRepositoryPort;
		attachmentBytes: AttachmentReadPort;
		settings: AppSettingsPort;
		runs: ExtractionRunRepositoryPort;
		provider: DocumentExtractionProviderPort;
		ids: IdGeneratorPort;
		clock: Clock;
	},
	input: ExtractFromDocumentInput,
	bounds: ExtractFromDocumentBounds
): Promise<{ runId: string }> {
	if (!getAiSettings({ settings: ports.settings }).enabled) {
		throw new ExtractionNotAllowedError('DISABLED');
	}
	if (!bounds.hasApiKey) throw new ExtractionNotAllowedError('NOT_CONFIGURED');

	const item = ports.items.getItemById(input.itemId);
	if (!item || item.status !== 'ACTIVE') throw new ExtractionNotAllowedError('ITEM_NOT_ACTIVE');

	const cycle = ports.cycles.getActiveCycle(input.itemId);
	if (!cycle) throw new ExtractionNotAllowedError('ITEM_NOT_ACTIVE');

	const attachment = ports.attachments.getById(input.attachmentId);
	if (!attachment || attachment.itemId !== input.itemId) {
		throw new ExtractionNotAllowedError('ATTACHMENT_NOT_FOUND');
	}
	if (!SUPPORTED_MIME_TYPES.includes(attachment.mimeType)) {
		throw new ExtractionNotAllowedError('UNSUPPORTED_TYPE');
	}
	if (attachment.byteSize > bounds.maxDocumentBytes) {
		throw new ExtractionNotAllowedError('TOO_LARGE');
	}

	const nowIso = ports.clock.nowIso();
	const windowStartIso = new Date(new Date(nowIso).getTime() - ONE_DAY_MS).toISOString();
	const runId = ports.ids.newId();

	try {
		ports.runs.claimRun({
			id: runId,
			itemId: input.itemId,
			cycleId: cycle.id,
			attachmentId: attachment.id,
			sourceFilename: attachment.filename,
			providerId: ports.provider.providerId,
			modelId: ports.provider.modelId,
			createdAt: nowIso,
			windowStartIso,
			dailyLimit: bounds.dailyLimit
		});
	} catch (cause) {
		if (cause instanceof DailyExtractionLimitReachedError) {
			throw new ExtractionNotAllowedError('DAILY_LIMIT');
		}
		throw cause;
	}

	// Everything from here on runs against a persisted RUNNING row: any
	// failure — provider, or a local one (a bad read, a broken settings
	// value) — must still land on markFailed, or the row stays RUNNING
	// forever while still counting toward the daily cap (see the review
	// round-01 finding on unhandled post-claim failures).
	try {
		const fields = ports.fields
			.listFields(cycle.id)
			.map((field) => ({ fieldKey: field.fieldKey, label: field.label, type: field.type }));
		const existingActionTitles = ports.actions
			.listActions(cycle.id)
			.slice(0, MAX_EXISTING_ACTION_TITLES)
			.map((action) => action.label.slice(0, MAX_EXISTING_ACTION_TITLE_LENGTH));
		const instruction = getAiSettings({ settings: ports.settings }).instruction;
		const contract = buildExtractionContract(fields, existingActionTitles);
		const bytes = ports.attachmentBytes.readBytes(attachment.storageKey, bounds.maxDocumentBytes);
		// `attachment.byteSize` is stored metadata and can disagree with the
		// file actually on disk (e.g. a restored backup with a checksum
		// mismatch — attachmentReconciliation only reports that, it does not
		// block a restore). The real bytes are checked again here, before
		// they are ever handed to a provider, so stale metadata can never
		// let an oversized document through (review round-02 finding 2).
		if (bytes.byteLength > bounds.maxDocumentBytes) {
			throw new ExtractionNotAllowedError('TOO_LARGE');
		}

		const result = await ports.provider.extract({
			contract,
			userInstruction: instruction,
			fields,
			existingActionTitles,
			document: { mimeType: attachment.mimeType, bytes },
			timeoutMs: bounds.timeoutMs,
			maxOutputTokens: bounds.maxOutputTokens
		});

		const { kept, discarded } = filterSuggestions(result.suggestions, fields);
		const { kept: keptAdditional, discarded: discardedAdditional } = filterAdditionalSuggestions(
			result.additionalSuggestions ?? [],
			fields
		);
		const { kept: keptActions, discarded: discardedActions } = filterActionSuggestions(
			result.actionSuggestions ?? [],
			fields,
			existingActionTitles
		);
		const discardedActionsByReason: NonNullable<
			MarkExtractionRunSucceededInput['diagnostics']
		>['discardedActionsByReason'] = {};
		for (const { reason } of discardedActions) {
			discardedActionsByReason[reason] = (discardedActionsByReason[reason] ?? 0) + 1;
		}
		ports.runs.markSucceeded(runId, {
			diagnostics: {
				provider: result.diagnostics,
				maxOutputTokens: bounds.maxOutputTokens,
				mappedActionCount: result.actionSuggestions?.length ?? 0,
				discardedActionsByReason
			},
			actionSuggestions: keptActions.map((suggestion, position) => ({
				title: suggestion.title,
				context: suggestion.context,
				evidence: suggestion.evidence,
				date: suggestion.date,
				position
			})),
			discardedActionCount: discardedActions.length,
			suggestions: kept.map((suggestion, position) => ({ ...suggestion, position })),
			discardedCount: discarded.length,
			additionalSuggestions: keptAdditional.map((suggestion, position) => ({
				...suggestion,
				evidence: suggestion.evidence ?? null,
				position
			})),
			discardedAdditionalCount: discardedAdditional.length
		});

		return { runId };
	} catch (cause) {
		ports.runs.markFailed(runId);
		if (cause instanceof AttachmentReadLimitError) {
			throw new ExtractionNotAllowedError('TOO_LARGE');
		}
		// A provider-typed failure already carries a safe, mapped meaning
		// (see extraction.ts); anything else (e.g. a filesystem error from
		// attachmentBytes.readBytes) is a local failure that must not reach
		// the route as a raw, unmapped exception carrying a path or a
		// stack — collapse it into the same generic, safe failure type.
		if (
			cause instanceof ExtractionUnavailableError ||
			cause instanceof ExtractionRateLimitError ||
			cause instanceof ExtractionTimeoutError ||
			cause instanceof ExtractionFailedError ||
			cause instanceof ExtractionMalformedOutputError ||
			cause instanceof ExtractionNotAllowedError
		) {
			throw cause;
		}
		throw new ExtractionFailedError('extraction failed before a provider result was available');
	}
}
