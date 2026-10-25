import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
	ActionDateKind,
	ActionDateRelation,
	ActionDateUnit
} from '$lib/application/ai/extraction';
import type {
	AddActionFromRunSelection,
	AddActionsFromRunInput,
	AddAdditionalFieldsInput,
	ExtractionActionSuggestionRecord,
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
import { normalizeSourceText } from '$lib/domain/field/field';
import {
	AdditionalSuggestionNotFoundError,
	DailyExtractionLimitReachedError,
	ExtractionRunNotReviewableError
} from '$lib/application/ai/ports';
import { addManualAction } from './actionRepository';
import { insertCustomFieldRow } from './fieldRepository';
import { applyFieldUpdatesAndRecalculate } from './scheduleRepository';
import { assertCycleIsWritable } from './writeGuards';
import { FieldGroupTargetNotFoundError } from './fieldGroupRepository';

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
				 SET status = 'NEW', suggested_count = ?, discarded_count = ?, discarded_additional_count = ?,
				     discarded_action_count = ?
				 WHERE id = ? AND status = 'RUNNING'`
			)
			.run(
				input.suggestions.length,
				input.discardedCount,
				input.discardedAdditionalCount,
				input.discardedActionCount ?? 0,
				runId
			);
		if (changed.changes !== 1) return;

		for (const suggestion of input.suggestions) {
			db.prepare(
				`INSERT INTO extraction_suggestions (id, run_id, field_key, value, source_text, position, accepted)
				 VALUES (?, ?, ?, ?, ?, ?, 0)`
			).run(
				crypto.randomUUID(),
				runId,
				suggestion.fieldKey,
				suggestion.value,
				normalizeSourceText(suggestion.sourceText),
				suggestion.position
			);
		}

		for (const suggestion of input.additionalSuggestions) {
			db.prepare(
				`INSERT INTO extraction_additional_suggestions
				 (id, run_id, suggested_label, suggested_type, value, evidence, position, accepted)
				 VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
			).run(
				crypto.randomUUID(),
				runId,
				suggestion.suggestedLabel,
				suggestion.suggestedType,
				suggestion.value,
				suggestion.evidence ?? null,
				suggestion.position
			);
		}

		for (const suggestion of input.actionSuggestions ?? []) {
			const relative = suggestion.date.relative;
			db.prepare(
				`INSERT INTO extraction_action_suggestions
				 (id, run_id, title, context, evidence, date_kind, date_value,
				  rel_relation, rel_amount, rel_unit, rel_anchor_key, rel_anchor_date, rel_anchor_label,
				  position, accepted)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
			).run(
				crypto.randomUUID(),
				runId,
				suggestion.title,
				suggestion.context,
				suggestion.evidence,
				suggestion.date.kind,
				suggestion.date.value,
				relative?.relation ?? null,
				relative?.amount ?? null,
				relative?.unit ?? null,
				relative?.anchorFieldKey ?? null,
				relative?.anchorDate ?? null,
				relative?.anchorLabel ?? null,
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
		'SELECT field_key, value, source_text, position, accepted FROM extraction_suggestions WHERE run_id = ? ORDER BY position';
	const rows = db.prepare(query).all(runId) as {
		field_key: string;
		value: string;
		source_text: string | null;
		position: number;
		accepted: number;
	}[];
	return rows.map((row) => ({
		fieldKey: row.field_key,
		value: row.value,
		sourceText: row.source_text,
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

		if (input.actions?.length) {
			assertCycleIsWritable(db, input.cycleId);
			insertActionsFromSuggestions(db, input.runId, input.cycleId, input.actions);
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

export function listActionSuggestions(
	db: Database.Database,
	runId: string
): ExtractionActionSuggestionRecord[] {
	const rows = db
		.prepare(
			`SELECT id, title, context, evidence, date_kind, date_value, rel_relation, rel_amount,
			        rel_unit, rel_anchor_key, rel_anchor_date, rel_anchor_label, position, accepted
			 FROM extraction_action_suggestions WHERE run_id = ? ORDER BY position`
		)
		.all(runId) as {
		id: string;
		title: string;
		context: string | null;
		evidence: string | null;
		date_kind: string;
		date_value: string | null;
		rel_relation: string | null;
		rel_amount: number | null;
		rel_unit: string | null;
		rel_anchor_key: string | null;
		rel_anchor_date: string | null;
		rel_anchor_label: string | null;
		position: number;
		accepted: number;
	}[];
	return rows.map((row) => ({
		id: row.id,
		title: row.title,
		context: row.context,
		evidence: row.evidence,
		date: {
			kind: row.date_kind as ActionDateKind,
			value: row.date_value,
			relative:
				row.rel_relation &&
				row.rel_amount &&
				row.rel_unit &&
				(row.rel_anchor_key || (row.rel_anchor_date && row.rel_anchor_label))
					? {
							relation: row.rel_relation as ActionDateRelation,
							amount: row.rel_amount,
							unit: row.rel_unit as ActionDateUnit,
							anchorFieldKey: row.rel_anchor_key,
							anchorDate: row.rel_anchor_date,
							anchorLabel: row.rel_anchor_label
						}
					: null
		},
		position: row.position,
		accepted: row.accepted === 1
	}));
}

/**
 * Creates ordinary MANUAL Actions from selected Action suggestions in one
 * transaction. Guarded like `addAdditionalFields`: item/cycle writable and
 * run still NEW first, so an applied or dismissed run can never create
 * Actions. Each Action goes through `addManualAction`, the same insert a
 * hand-added task uses: there is no separate "AI Action".
 */
export function addActions(db: Database.Database, input: AddActionsFromRunInput): void {
	db.transaction(() => {
		assertCycleIsWritable(db, input.cycleId);

		const run = db
			.prepare(`SELECT status FROM extraction_runs WHERE id = ? AND item_id = ? AND cycle_id = ?`)
			.get(input.runId, input.itemId, input.cycleId) as { status: string } | undefined;
		if (!run || run.status !== 'NEW') throw new ExtractionRunNotReviewableError();

		insertActionsFromSuggestions(db, input.runId, input.cycleId, input.selections);
	})();
}

function insertActionsFromSuggestions(
	db: Database.Database,
	runId: string,
	cycleId: string,
	selections: readonly AddActionFromRunSelection[]
): void {
	for (const selection of selections) {
		const suggestion = db
			.prepare(
				`SELECT id FROM extraction_action_suggestions WHERE id = ? AND run_id = ? AND accepted = 0`
			)
			.get(selection.suggestionId, runId) as { id: string } | undefined;
		if (!suggestion) throw new AdditionalSuggestionNotFoundError();

		addManualAction(db, cycleId, {
			label: selection.label,
			dueDate: selection.dueDate,
			description: selection.description
		});
		db.prepare(`UPDATE extraction_action_suggestions SET accepted = 1 WHERE id = ?`).run(
			selection.suggestionId
		);
	}
}

export function listAdditionalSuggestions(
	db: Database.Database,
	runId: string
): ExtractionAdditionalSuggestionRecord[] {
	const query =
		'SELECT id, suggested_label, suggested_type, value, evidence, position, accepted FROM extraction_additional_suggestions WHERE run_id = ? ORDER BY position';
	const rows = db.prepare(query).all(runId) as {
		id: string;
		suggested_label: string;
		suggested_type: string;
		value: string;
		evidence: string | null;
		position: number;
		accepted: number;
	}[];
	return rows.map((row) => ({
		id: row.id,
		suggestedLabel: row.suggested_label,
		suggestedType: row.suggested_type as SuggestedFieldType,
		value: row.value,
		evidence: row.evidence,
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
					`SELECT id, evidence, suggested_type, value FROM extraction_additional_suggestions
					 WHERE id = ? AND run_id = ? AND accepted = 0`
				)
				.get(selection.suggestionId, input.runId) as
				{ id: string; evidence: string | null; suggested_type: string; value: string } | undefined;
			if (!suggestion) throw new AdditionalSuggestionNotFoundError();
			const group = db
				.prepare('SELECT 1 FROM item_field_groups WHERE id = ? AND item_id = ?')
				.get(selection.groupId, input.itemId);
			if (!group) throw new FieldGroupTargetNotFoundError();

			const field = insertCustomFieldRow(db, input.cycleId, {
				label: selection.label,
				type: selection.type
			});

			if (selection.value !== null) {
				applyFieldUpdatesAndRecalculate(db, input.cycleId, [
					{
						fieldKey: field.fieldKey,
						value: selection.value,
						sourceText:
							selection.value === suggestion.value && selection.type === suggestion.suggested_type
								? suggestion.evidence
								: null
					}
				]);
			}
			db.prepare(
				`INSERT INTO item_field_group_assignments (item_id, field_key, group_id)
				 VALUES (?, ?, ?)
				 ON CONFLICT (item_id, field_key) DO UPDATE SET group_id = excluded.group_id`
			).run(input.itemId, field.fieldKey, selection.groupId);

			db.prepare(`UPDATE extraction_additional_suggestions SET accepted = 1 WHERE id = ?`).run(
				selection.suggestionId
			);
		}
	})();
}
