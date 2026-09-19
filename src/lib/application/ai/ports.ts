/**
 * Synchronous repository ports for the AI feature, kept separate from
 * `$lib/application/ports.ts` on purpose: that file is documented and
 * reviewed as the set of ports with no `Promise` in it, and the one async
 * boundary this feature needs (`DocumentExtractionProviderPort`, in
 * `extraction.ts`) would hide inside it. `AppSettingsPort`,
 * `AttachmentReadPort` and `ExtractionRunRepositoryPort` are synchronous
 * and live next to the feature they serve instead.
 */
export type { SuggestedFieldType } from './extraction';
import type { SuggestedFieldType } from './extraction';

export type ExtractionRunStatus = 'RUNNING' | 'NEW' | 'FAILED' | 'APPLIED' | 'DISMISSED';

export interface ExtractionRun {
	id: string;
	itemId: string;
	cycleId: string;
	/** Null once the source attachment has been deleted (ON DELETE SET
	 *  NULL, not CASCADE) — the run row and its count survive; only the
	 *  link to the now-gone attachment is lost (review round-02 finding 1). */
	attachmentId: string | null;
	/** Original source name, retained even after attachment deletion so a
	 *  review always identifies the document that produced the suggestions. */
	sourceFilename: string;
	providerId: string;
	modelId: string;
	status: ExtractionRunStatus;
	suggestedCount: number;
	discardedCount: number;
	createdAt: string;
	reviewedAt: string | null;
}

export interface ExtractionSuggestionRecord {
	fieldKey: string;
	value: string;
	position: number;
	accepted: boolean;
}

/** AI Extraction 1.1: a suggested administrative fact the Item has no
 *  field for yet. `id` (unlike a known-field suggestion) is how the
 *  review page and `addAdditionalFields` refer to one specific row —
 *  there is no `fieldKey` to key off, since the field doesn't exist. */
export interface ExtractionAdditionalSuggestionRecord {
	id: string;
	suggestedLabel: string;
	suggestedType: SuggestedFieldType;
	value: string;
	position: number;
	accepted: boolean;
}

export interface ClaimExtractionRunInput {
	id: string;
	itemId: string;
	cycleId: string;
	attachmentId: string;
	/** Required for production claims. Optional only while reading legacy
	 *  callers created before source names were retained. */
	sourceFilename?: string;
	providerId: string;
	modelId: string;
	createdAt: string;
	/** Rolling 24h window start (createdAt - 24h), computed by the caller so
	 *  the comparison stays a plain TEXT compare against `created_at`
	 *  (both ISO 8601 with milliseconds, matching every other timestamp
	 *  comparison in this codebase). */
	windowStartIso: string;
	dailyLimit: number;
}

/** Thrown by `claimRun` when the rolling 24h window already holds
 *  `dailyLimit` attempts (of any status). The check-and-insert happens
 *  inside one `BEGIN IMMEDIATE` transaction, so two concurrent callers can
 *  never both claim the final slot (see B100). */
export class DailyExtractionLimitReachedError extends Error {}

export interface MarkExtractionRunSucceededInput {
	suggestions: readonly { fieldKey: string; value: string; position: number }[];
	discardedCount: number;
	additionalSuggestions: readonly {
		suggestedLabel: string;
		suggestedType: SuggestedFieldType;
		value: string;
		position: number;
	}[];
	discardedAdditionalCount: number;
}

export interface ApplyExtractionRunInput {
	runId: string;
	itemId: string;
	cycleId: string;
	/** Already validated (normalizeFieldUpdates) and already intersected
	 *  with this run's persisted suggestions. */
	updates: readonly { fieldKey: string; value: string | null }[];
	acceptedFieldKeys: readonly string[];
	reviewedAt: string;
}

export interface DismissExtractionRunInput {
	runId: string;
	itemId: string;
	cycleId: string;
	reviewedAt: string;
}

/** Thrown by `applyRun`/`dismissRun` when the run is not (or no longer)
 *  `NEW` for the given item/cycle — a stale id, a double submit, an
 *  already-reviewed run, or a run that belongs to a different item. One
 *  error for every reason, deliberately (matches ActionNotMutableError /
 *  ItemNotWritableError elsewhere in the codebase). */
export class ExtractionRunNotReviewableError extends Error {}

/** Thrown when a selected additional-suggestion id does not resolve to an
 *  unaccepted row belonging to this run — a stale id, a double submit, or
 *  a suggestion id from a different run entirely. One error for every
 *  reason (matches `ExtractionRunNotReviewableError`'s own convention). */
export class AdditionalSuggestionNotFoundError extends Error {}

/** One accepted additional suggestion, as chosen (and possibly edited) by
 *  the user on the review page. The label may be renamed and the type
 *  changed before creation — see AI Extraction 1.1, section 6. `value` is
 *  already validated and in its final storage form by the time it
 *  reaches this port (see `application/ai/addAdditionalFieldsFromRun.ts`,
 *  which calls the same `validateAndNormalizeFieldValue` a hand-typed
 *  field update or a known-field suggestion goes through) — the
 *  repository below only ever writes it, never re-derives it. */
export interface AddAdditionalFieldSelection {
	suggestionId: string;
	label: string;
	type: SuggestedFieldType;
	value: string | null;
}

export interface AddAdditionalFieldsInput {
	runId: string;
	itemId: string;
	cycleId: string;
	selections: readonly AddAdditionalFieldSelection[];
}

export interface ExtractionRunRepositoryPort {
	/** Inside one immediate write transaction: count attempts in the
	 *  rolling window, reject if at the cap, else insert the RUNNING row.
	 *  Throws {@link DailyExtractionLimitReachedError}. Never holds the
	 *  transaction open across the provider call — this returns before the
	 *  caller ever awaits `provider.extract()`. */
	claimRun(input: ClaimExtractionRunInput): void;
	/** RUNNING -> NEW, plus the kept suggestions, in one transaction. A
	 *  no-op if the run is no longer RUNNING (defensive; not expected to
	 *  happen in practice). */
	markSucceeded(runId: string, input: MarkExtractionRunSucceededInput): void;
	/** RUNNING -> FAILED. A no-op if the run is no longer RUNNING. */
	markFailed(runId: string): void;
	getById(runId: string): ExtractionRun | null;
	/** The newest `NEW` run for a cycle, or null. Cycle-scoped (not
	 *  item-scoped): after a rollover, an old cycle's pending runs stop
	 *  showing as pending for the new cycle with no migration needed. */
	findNewestPendingRun(cycleId: string): ExtractionRun | null;
	listSuggestions(runId: string): ExtractionSuggestionRecord[];
	listAdditionalSuggestions(runId: string): ExtractionAdditionalSuggestionRecord[];
	/** One transaction: guards the item/cycle is still writable and the run
	 *  is still `NEW` (a run already applied/dismissed can never spawn more
	 *  fields), creates one CUSTOM field per selection through the same
	 *  repository path `addCustomField` uses, sets its value through the
	 *  normal field-update/recalculation code, and marks each selected
	 *  suggestion accepted — either every selection succeeds or none does.
	 *  Throws {@link ExtractionRunNotReviewableError} /
	 *  {@link AdditionalSuggestionNotFoundError} / `ItemNotWritableError` /
	 *  the usual field-validation errors from `updateItemFields.ts`. */
	addAdditionalFields(input: AddAdditionalFieldsInput): void;
	/** One transaction: guarded NEW -> APPLIED, the field writes and
	 *  recalculation through the existing schedule repository, and marking
	 *  the accepted suggestions — see B101. Throws
	 *  {@link ExtractionRunNotReviewableError}. */
	applyRun(input: ApplyExtractionRunInput): void;
	/** One guarded atomic NEW -> DISMISSED transition. Throws
	 *  {@link ExtractionRunNotReviewableError}. */
	dismissRun(input: DismissExtractionRunInput): void;
}

export interface AppSettingsPort {
	get(key: string): string | null;
	set(key: string, value: string): void;
}

/** A narrow read-only slice of `AttachmentStoragePort` — extraction only
 *  ever reads bytes, never stores, streams or removes them. */
export interface AttachmentReadPort {
	readBytes(storageKey: string, maxBytes: number): Uint8Array;
}
