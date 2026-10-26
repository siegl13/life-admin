import type { AttachmentMimeType } from '../../domain/attachment/attachment';

/**
 * The whole AI boundary. Deliberately duplicates the three attributes a
 * provider needs rather than importing `Field`: a provider adapter must
 * never receive a database id, a cycle id, an origin or a position. There
 * is also no `currentValue` and no `isFilled` — the provider extracts what
 * the selected document states; whether a field already has a value is
 * relevant only during human review, which happens locally (see
 * getExtractionRun.ts). That absence is structural, not procedural: there
 * is no field on this type that could carry a stored value to the
 * provider at all.
 */
export interface ExtractionFieldDefinition {
	fieldKey: string;
	label: string;
	type: 'text' | 'date' | 'currency';
}

/**
 * The three field types an "additional" suggestion (AI Extraction 1.1) may
 * declare for itself — never anything the model invents. This is the same
 * set `Field.type` supports; kept as its own literal union (not imported
 * from `$lib/domain/field/field`) for the same reason
 * `ExtractionFieldDefinition` above duplicates rather than imports `Field`:
 * this file is the whole trust boundary with the provider, and must not
 * grow a dependency that could quietly widen in the domain later.
 */
export type SuggestedFieldType = 'text' | 'date' | 'currency';

/**
 * No filename property. The active provider adapter alone derives a
 * neutral filename from the validated MIME type where its wire format
 * requires one — a caller cannot supply or override a provider filename
 * because there is no field here to put it in (see `server/ai/**`, the
 * only layer allowed to know a specific provider's wire shape).
 */
export interface ExtractionDocument {
	mimeType: AttachmentMimeType;
	bytes: Uint8Array;
}

export interface ExtractionRequest {
	/** Fixed, application-controlled. Not user-editable. */
	contract: string;
	/** The one global user-editable instruction. */
	userInstruction: string;
	fields: readonly ExtractionFieldDefinition[];
	/** Titles of the Item's existing Actions, passed only so the model can
	 *  avoid suggesting an Action that already exists. Titles only: no
	 *  descriptions, dates, states or ids. Optional for providers and
	 *  fixtures that predate Action suggestions. */
	existingActionTitles?: readonly string[];
	document: ExtractionDocument;
	timeoutMs: number;
	maxOutputTokens: number;
}

export interface ExtractionSuggestion {
	fieldKey: string;
	/** Always a raw string. Typing is the application's job (filterSuggestions,
	 *  then normalizeFieldUpdates), never the model's. */
	value: string;
	/** Short exact excerpt supporting the value, when available. */
	sourceText?: string | null;
}

/**
 * A useful administrative fact the document contains that the current
 * Item has no field for yet (AI Extraction 1.1). Deliberately minimal:
 * no `fieldKey` (it doesn't exist as a field yet), no confidence, no
 * reasoning, no suggested Action/reminder — this is Item-information
 * only, exactly as untrusted as a known-field suggestion, validated the
 * same way (see `filterAdditionalSuggestions.ts`) before it can ever
 * become a real Custom Field.
 */
export interface ExtractionAdditionalSuggestion {
	suggestedLabel: string;
	suggestedType: SuggestedFieldType;
	value: string;
	/** Reuse the established evidence contract for additional suggestions. */
	evidence?: string | null;
}

/**
 * How a suggested Action's date should be read. DUE_BY and ON_DATE become
 * the ordinary due date; AVAILABLE_FROM, APPROXIMATE and NONE never do (an
 * availability or an estimate is not a deadline). Not a new scheduling
 * model: it only decides whether the existing due date may be set.
 */
export type ActionDateKind = 'DUE_BY' | 'AVAILABLE_FROM' | 'ON_DATE' | 'APPROXIMATE' | 'NONE';
export type ActionDateRelation = 'BEFORE' | 'AFTER';
export type ActionDateUnit = 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS';

/** "<amount> <unit> BEFORE/AFTER <anchor>": the model only names the
 *  relation. The application calculates the date (resolveActionDate.ts). */
export interface ActionRelativeDate {
	relation: ActionDateRelation;
	amount: number;
	unit: ActionDateUnit;
	/** `fieldKey` of an Item date field. Null for a document anchor. */
	anchorFieldKey: string | null;
	/** Document anchor: a date the document states explicitly (YYYY-MM-DD)
	 *  and that no Item field holds, with a short label for it. The model
	 *  copies it; it never calculates the resulting date. */
	anchorDate?: string | null;
	anchorLabel?: string | null;
}

export interface ActionSuggestionDate {
	kind: ActionDateKind;
	/** Absolute ISO date stated in the document, if any. */
	value: string | null;
	relative: ActionRelativeDate | null;
}

/**
 * A generic next step the document implies for the user (never a plain
 * fact, which stays an Item field). Untrusted like every other suggestion:
 * validated by `filterActionSuggestions.ts`, shown for review, and only
 * turned into an ordinary Action after explicit selection.
 */
export interface ExtractionActionSuggestion {
	title: string;
	context: string | null;
	/** Short quote or paraphrase from the document. Not model reasoning. */
	evidence: string | null;
	/** `ALREADY_DONE` suggestions are discarded; absent means open. */
	status?: 'OPEN' | 'ALREADY_DONE' | null;
	date: ActionSuggestionDate;
}

/** Counts only. Never contains source text, prompts or provider responses. */
export interface ExtractionProviderDiagnostics {
	completionStatus: 'completed';
	providerActionCount: number;
	schemaValidActionCount: number;
	inputTokens: number | null;
	outputTokens: number | null;
}

export interface ExtractionResult {
	suggestions: readonly ExtractionSuggestion[];
	/** Optional for the same reason as `additionalSuggestions`. */
	actionSuggestions?: readonly ExtractionActionSuggestion[];
	/** Optional so a provider (or a fixture) that predates this feature
	 *  still type-checks and behaves exactly as before — absent is
	 *  equivalent to "found nothing additional". */
	additionalSuggestions?: readonly ExtractionAdditionalSuggestion[];
	providerId: string;
	modelId: string;
	diagnostics?: ExtractionProviderDiagnostics;
}

/**
 * One provider-neutral port, one method. `providerId`/`modelId` are plain
 * metadata (not part of "the one method"): the daily-attempt accounting
 * (B100) needs them to persist a RUNNING row *before* the provider call
 * completes, so they must be known without awaiting `extract()`.
 */
export interface DocumentExtractionProviderPort {
	readonly providerId: string;
	readonly modelId: string;
	extract(request: ExtractionRequest): Promise<ExtractionResult>;
}

/** No key configured, an unauthorized response, or a network failure —
 *  none of these are the caller's fault, all mean "AI cannot run right
 *  now". Mapped to `ai.error.notConfigured`. */
export class ExtractionUnavailableError extends Error {}
/** The request was aborted after `timeoutMs`. Mapped to `ai.error.failed`. */
export class ExtractionTimeoutError extends Error {}
/** The provider rejected the request because its usage or rate limit was reached. */
export class ExtractionRateLimitError extends Error {}
/** A provider-side error (5xx). Mapped to `ai.error.failed`. */
export class ExtractionFailedError extends Error {}
/** A non-JSON body or a schema/strict-parse failure. Mapped to `ai.error.failed`. */
export class ExtractionMalformedOutputError extends Error {}
