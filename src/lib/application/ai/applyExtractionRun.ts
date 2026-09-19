import {
	normalizeFieldUpdates,
	UnknownFieldError,
	InvalidDateValueError
} from '../items/updateItemFields';
import type { Clock, FieldRepositoryPort } from '../ports';
import type { ExtractionRunRepositoryPort } from './ports';

export { UnknownFieldError, InvalidDateValueError };

export class ExtractionRunNotFoundError extends Error {}

export interface ApplyExtractionRunInput {
	itemId: string;
	runId: string;
	/** Raw field keys as posted by the browser. Intersected below against
	 *  this run's persisted suggestions — a key posted that is not in the
	 *  run is ignored, not trusted. */
	acceptedFieldKeys: readonly string[];
}

/**
 * Accepts a subset of a run's suggestions. Validates with the exact same
 * algorithm `updateItemFields` uses (normalizeFieldUpdates — no second
 * write path), then hands the atomic claim/write/recalculate/mark-applied
 * transaction to the repository (see B101 and extractionRepository.applyRun).
 */
export interface ApplyExtractionRunResult {
	acceptedCount: number;
}

export function applyExtractionRun(
	ports: { runs: ExtractionRunRepositoryPort; fields: FieldRepositoryPort; clock: Clock },
	input: ApplyExtractionRunInput
): ApplyExtractionRunResult {
	const run = ports.runs.getById(input.runId);
	if (!run || run.itemId !== input.itemId) throw new ExtractionRunNotFoundError();

	const suggestionsByKey = new Map(
		ports.runs.listSuggestions(run.id).map((suggestion) => [suggestion.fieldKey, suggestion])
	);
	const selectedKeys = input.acceptedFieldKeys.filter((key) => suggestionsByKey.has(key));

	const rawUpdates = selectedKeys.map((key) => ({
		fieldKey: key,
		value: suggestionsByKey.get(key)!.value
	}));
	const normalized = normalizeFieldUpdates(ports.fields.listFields(run.cycleId), rawUpdates);

	ports.runs.applyRun({
		runId: run.id,
		itemId: run.itemId,
		cycleId: run.cycleId,
		updates: normalized,
		acceptedFieldKeys: selectedKeys,
		reviewedAt: ports.clock.nowIso()
	});

	return { acceptedCount: selectedKeys.length };
}
