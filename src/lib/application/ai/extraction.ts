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
	document: ExtractionDocument;
	timeoutMs: number;
	maxOutputTokens: number;
}

export interface ExtractionSuggestion {
	fieldKey: string;
	/** Always a raw string. Typing is the application's job (filterSuggestions,
	 *  then normalizeFieldUpdates), never the model's. */
	value: string;
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
}

export interface ExtractionResult {
	suggestions: readonly ExtractionSuggestion[];
	/** Optional so a provider (or a fixture) that predates this feature
	 *  still type-checks and behaves exactly as before — absent is
	 *  equivalent to "found nothing additional". */
	additionalSuggestions?: readonly ExtractionAdditionalSuggestion[];
	providerId: string;
	modelId: string;
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
/** A rate limit or provider-side error (429/5xx). Mapped to `ai.error.failed`. */
export class ExtractionFailedError extends Error {}
/** A non-JSON body or a schema/strict-parse failure. Mapped to `ai.error.failed`. */
export class ExtractionMalformedOutputError extends Error {}
