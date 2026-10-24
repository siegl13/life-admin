import {
	normalizeFieldUpdates,
	UnknownFieldError,
	InvalidDateValueError
} from '../items/updateItemFields';
import type { ActionRepositoryPort, Clock, FieldRepositoryPort } from '../ports';
import { planActionSelections, type ActionSelectionInput } from './addActionsFromRun';
import { selectFieldWrites } from './fieldComparison';
import type { ExtractionRunRepositoryPort } from './ports';

export { UnknownFieldError, InvalidDateValueError };

export class ExtractionRunNotFoundError extends Error {}

export interface ApplyExtractionRunInput {
	itemId: string;
	runId: string;
	/** Raw field keys as posted by the browser: the NEW values the user
	 *  kept selected. Intersected below against this run's persisted
	 *  suggestions — a key posted that is not in the run is ignored, not
	 *  trusted. */
	acceptedFieldKeys: readonly string[];
	/** Field keys whose CONFLICTING value the user explicitly chose to
	 *  replace ("use document value"). The only way an existing value is
	 *  ever overwritten. */
	replaceFieldKeys?: readonly string[];
	/** "Accept all": every NEW value, regardless of the individual
	 *  selection. Conflicts stay unresolved: `replaceFieldKeys` is ignored. */
	acceptAllNew?: boolean;
	/** Action suggestions selected together with the fields. They are planned
	 *  against the values that will be saved and created in the same
	 *  transaction, so a failing field write leaves no Action behind. */
	actions?: ActionSelectionInput;
}

/**
 * Applies the part of a run the user approved. Validates with the exact
 * same algorithm `updateItemFields` uses (normalizeFieldUpdates — no second
 * write path), then hands the atomic claim/write/recalculate/mark-applied
 * transaction to the repository (see B101 and extractionRepository.applyRun).
 *
 * Each value is classified again here against the Item's *current* value,
 * never against what the browser saw: a field that was empty at review but
 * has been filled since is a conflict now, and without an explicit replace
 * choice it is left alone. No path through this function overwrites a
 * non-empty value silently.
 */
export interface ApplyExtractionRunResult {
	/** Fields whose stored value actually changed. */
	changedCount: number;
	/** Selected values left untouched because they conflict with a
	 *  non-empty current value and were not explicitly replaced. */
	keptCurrentCount: number;
	/** Actions created from the selected Action suggestions. */
	createdActionCount: number;
}

export function applyExtractionRun(
	ports: {
		runs: ExtractionRunRepositoryPort;
		fields: FieldRepositoryPort;
		actions: ActionRepositoryPort;
		clock: Clock;
	},
	input: ApplyExtractionRunInput
): ApplyExtractionRunResult {
	const run = ports.runs.getById(input.runId);
	if (!run || run.itemId !== input.itemId) throw new ExtractionRunNotFoundError();

	const fields = ports.fields.listFields(run.cycleId);
	const { writes, keptCurrentCount } = selectFieldWrites(
		fields,
		ports.runs.listSuggestions(run.id),
		input
	);

	// Validate every selected write before anything is persisted.
	const normalized = normalizeFieldUpdates(fields, writes);
	const plannedActions = input.actions
		? planActionSelections(ports, run, input.actions, input).selections
		: [];

	ports.runs.applyRun({
		runId: run.id,
		itemId: run.itemId,
		cycleId: run.cycleId,
		updates: normalized,
		acceptedFieldKeys: writes.map((write) => write.fieldKey),
		actions: plannedActions,
		reviewedAt: ports.clock.nowIso()
	});

	return {
		changedCount: writes.length,
		keptCurrentCount,
		createdActionCount: plannedActions.length
	};
}
