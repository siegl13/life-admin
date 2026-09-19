import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
	AddAdditionalFieldsInput,
	ApplyExtractionRunInput,
	ClaimExtractionRunInput,
	DismissExtractionRunInput,
	ExtractionAdditionalSuggestionRecord,
	ExtractionRun,
	ExtractionRunStatus,
	ExtractionSuggestionRecord,
	MarkExtractionRunSucceededInput,
	SuggestedFieldType
} from '$lib/application/ai/ports';
import {
	AdditionalSuggestionNotFoundError,
	DailyExtractionLimitReachedError,
	ExtractionRunNotReviewableError
} from '$lib/application/ai/ports';
import { insertCustomFieldRow } from './fieldRepository';
import { applyFieldUpdatesAndRecalculate } from './scheduleRepository';
import { assertCycleIsWritable } from './writeGuards';

interface RunRow {
	id: string;
	item_id: string;
	cycle_id: string;
	attachment_id: string | null;
	source_filename: string;
	provider_id: string;
	model_id: string;
	status: string;
	suggested_count: number;
	discarded_count: number;
	discarded_additional_count: number;
	created_at: string;
	reviewed_at: string | null;
}

function mapRun(row: RunRow): ExtractionRun {
	return {
		id: row.id,
		itemId: row.item_id,
		cycleId: row.cycle_id,
		attachmentId: row.attachment_id,
		sourceFilename: row.source_filename,
		providerId: row.provider_id,
		modelId: row.model_id,
		status: row.status as ExtractionRunStatus,
		suggestedCount: row.suggested_count,
		discardedCount: row.discarded_count,
		createdAt: row.created_at,
		reviewedAt: row.reviewed_at
	};
}

/**
 * Counts attempts in the rolling window and inserts the RUNNING row inside
 * one `BEGIN IMMEDIATE` transaction (same pattern as
 * authRepository.recordFailedLogin): the write lock is acquired before the
 * count is read, so two concurrent callers can never both observe the
 * slot as free when only one remains. Never held open across the provider
 * HTTP call — this function returns long before that (see B100).
 */
export function claimRun(db: Database.Database, input: ClaimExtractionRunInput): void {
	const run = db.transaction(() => {
		const { n } = db
			.prepare('SELECT COUNT(*) n FROM extraction_runs WHERE created_at >= ?')
			.get(input.windowStartIso) as { n: number };
		if (n >= input.dailyLimit) throw new DailyExtractionLimitReachedError();

		db.prepare(
			`INSERT INTO extraction_runs
			 (id, item_id, cycle_id, attachment_id, source_filename, provider_id, model_id, status, suggested_count, discarded_count, created_at, reviewed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 'RUNNING', 0, 0, ?, NULL)`
		).run(
			input.id,
			input.itemId,
			input.cycleId,
			input.attachmentId,
			input.sourceFilename ?? '',
			input.providerId,
			input.modelId,
			input.createdAt
		);
	});
	run.immediate();
}

export function markSucceeded(
	db: Database.Database,
	runId: string,
	input: MarkExtractionRunSucceededInput
): void {
	db.transaction(() => {
		const changed = db
			.prepare(
				`UPDATE extraction_runs
				 SET status = 'NEW', suggested_count = ?, discarded_count = ?, discarded_additional_count = ?
				 WHERE id = ? AND status = 'RUNNING'`
			)
			.run(input.suggestions.length, input.discardedCount, input.discardedAdditionalCount, runId);
		if (changed.changes !== 1) return;

		for (const suggestion of input.suggestions) {
			db.prepare(
				`INSERT INTO extraction_suggestions (id, run_id, field_key, value, position, accepted)
				 VALUES (?, ?, ?, ?, ?, 0)`
			).run(crypto.randomUUID(), runId, suggestion.fieldKey, suggestion.value, suggestion.position);
		}

		for (const suggestion of input.additionalSuggestions) {
			db.prepare(
				`INSERT INTO extraction_additional_suggestions
				 (id, run_id, suggested_label, suggested_type, value, position, accepted)
				 VALUES (?, ?, ?, ?, ?, ?, 0)`
			).run(
				crypto.randomUUID(),
				runId,
				suggestion.suggestedLabel,
				suggestion.suggestedType,
				suggestion.value,
				suggestion.position
			);
		}
	})();
}

export function markFailed(db: Database.Database, runId: string): void {
	const query = `UPDATE extraction_runs SET status = 'FAILED' WHERE id = ? AND status = 'RUNNING'`;
	db.prepare(query).run(runId);
}

export function getById(db: Database.Database, runId: string): ExtractionRun | null {
	const row = db.prepare('SELECT * FROM extraction_runs WHERE id = ?').get(runId) as
		RunRow | undefined;
	return row ? mapRun(row) : null;
}

export function findNewestPendingRun(db: Database.Database, cycleId: string): ExtractionRun | null {
	const query = `SELECT * FROM extraction_runs WHERE cycle_id = ? AND status = 'NEW' ORDER BY created_at DESC LIMIT 1`;
	const row = db.prepare(query).get(cycleId) as RunRow | undefined;
	return row ? mapRun(row) : null;
}

export function listSuggestions(
	db: Database.Database,
	runId: string
): ExtractionSuggestionRecord[] {
	const query =
		'SELECT field_key, value, position, accepted FROM extraction_suggestions WHERE run_id = ? ORDER BY position';
	const rows = db.prepare(query).all(runId) as {
		field_key: string;
		value: string;
		position: number;
		accepted: number;
	}[];
	return rows.map((row) => ({
		fieldKey: row.field_key,
		value: row.value,
		position: row.position,
		accepted: row.accepted === 1
	}));
}

/**
 * The whole atomic review-accept transaction (B101): a guarded claim
 * (NEW -> APPLIED with reviewed_at) first, so a stale id, a wrong item/
 * cycle, or a double submit fails loudly before anything else runs; then
 * the field writes and recalculation through the existing, unmodified
 * `applyFieldUpdatesAndRecalculate` (better-sqlite3 nests this as a
 * SAVEPOINT inside the outer transaction — no second field-write
 * algorithm); then marking the accepted suggestions. Any failure rolls
 * back every step, including the claim.
 */
export function applyRun(db: Database.Database, input: ApplyExtractionRunInput): void {
	db.transaction(() => {
		const claimed = db
			.prepare(
				`UPDATE extraction_runs SET status = 'APPLIED', reviewed_at = ?
				 WHERE id = ? AND item_id = ? AND cycle_id = ? AND status = 'NEW'`
			)
			.run(input.reviewedAt, input.runId, input.itemId, input.cycleId);
		if (claimed.changes !== 1) throw new ExtractionRunNotReviewableError();

		if (input.updates.length > 0) {
			applyFieldUpdatesAndRecalculate(db, input.cycleId, input.updates);
		}

		for (const fieldKey of input.acceptedFieldKeys) {
			db.prepare(
				'UPDATE extraction_suggestions SET accepted = 1 WHERE run_id = ? AND field_key = ?'
			).run(input.runId, fieldKey);
		}
	})();
}

/** One guarded atomic NEW -> DISMISSED transition — no other row changes. */
export function dismissRun(db: Database.Database, input: DismissExtractionRunInput): void {
	const changed = db
		.prepare(
			`UPDATE extraction_runs SET status = 'DISMISSED', reviewed_at = ?
			 WHERE id = ? AND item_id = ? AND cycle_id = ? AND status = 'NEW'`
		)
		.run(input.reviewedAt, input.runId, input.itemId, input.cycleId);
	if (changed.changes !== 1) throw new ExtractionRunNotReviewableError();
}

export function listAdditionalSuggestions(
	db: Database.Database,
	runId: string
): ExtractionAdditionalSuggestionRecord[] {
	const query =
		'SELECT id, suggested_label, suggested_type, value, position, accepted FROM extraction_additional_suggestions WHERE run_id = ? ORDER BY position';
	const rows = db.prepare(query).all(runId) as {
		id: string;
		suggested_label: string;
		suggested_type: string;
		value: string;
		position: number;
		accepted: number;
	}[];
	return rows.map((row) => ({
		id: row.id,
		suggestedLabel: row.suggested_label,
		suggestedType: row.suggested_type as SuggestedFieldType,
		value: row.value,
		position: row.position,
		accepted: row.accepted === 1
	}));
}

/**
 * AI Extraction 1.1, section 7: adding several suggested fields is one
 * atomic operation — either every selection becomes a real CUSTOM field,
 * or none does. Guarded (item/cycle ACTIVE, run still NEW) as the first
 * statement in the transaction, per writeGuards.ts's own contract; each
 * selection then reuses `insertCustomFieldRow` (the same insert
 * `addCustomField` uses) and `applyFieldUpdatesAndRecalculate` (the same
 * write/recalculation path every other field value goes through) — no
 * second field-creation or field-write algorithm. A run that is no longer
 * `NEW` (already applied/dismissed, or a stale/wrong-item id) throws
 * before anything is created; a suggestion id that doesn't resolve to an
 * unaccepted row of this run does the same.
 */
export function addAdditionalFields(db: Database.Database, input: AddAdditionalFieldsInput): void {
	db.transaction(() => {
		assertCycleIsWritable(db, input.cycleId);

		const run = db
			.prepare(`SELECT status FROM extraction_runs WHERE id = ? AND item_id = ? AND cycle_id = ?`)
			.get(input.runId, input.itemId, input.cycleId) as { status: string } | undefined;
		if (!run || run.status !== 'NEW') throw new ExtractionRunNotReviewableError();

		for (const selection of input.selections) {
			const suggestion = db
				.prepare(
					`SELECT id FROM extraction_additional_suggestions WHERE id = ? AND run_id = ? AND accepted = 0`
				)
				.get(selection.suggestionId, input.runId) as { id: string } | undefined;
			if (!suggestion) throw new AdditionalSuggestionNotFoundError();

			const field = insertCustomFieldRow(db, input.cycleId, {
				label: selection.label,
				type: selection.type
			});

			if (selection.value !== null) {
				applyFieldUpdatesAndRecalculate(db, input.cycleId, [
					{ fieldKey: field.fieldKey, value: selection.value }
				]);
			}

			db.prepare(`UPDATE extraction_additional_suggestions SET accepted = 1 WHERE id = ?`).run(
				selection.suggestionId
			);
		}
	})();
}
