import type { Clock } from '../ports';
import type { ExtractionRunRepositoryPort } from './ports';
import { ExtractionRunNotFoundError } from './applyExtractionRun';

export { ExtractionRunNotFoundError };

export interface DismissExtractionRunInput {
	itemId: string;
	runId: string;
}

/** Marks a run DISMISSED and writes nothing else — one guarded atomic
 *  NEW -> DISMISSED transition (see extractionRepository.dismissRun). */
export function dismissExtractionRun(
	ports: { runs: ExtractionRunRepositoryPort; clock: Clock },
	input: DismissExtractionRunInput
): void {
	const run = ports.runs.getById(input.runId);
	if (!run || run.itemId !== input.itemId) throw new ExtractionRunNotFoundError();

	ports.runs.dismissRun({
		runId: run.id,
		itemId: run.itemId,
		cycleId: run.cycleId,
		reviewedAt: ports.clock.nowIso()
	});
}
