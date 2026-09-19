export const HISTORY_PAGE_SIZE = 10;
const MAX_HISTORY_FETCH = 500;

export function resolveHistoryLimit(rawHistoryCount: string | null): number {
	const requested = Number(rawHistoryCount);
	return Number.isFinite(requested) && requested > HISTORY_PAGE_SIZE
		? Math.min(requested, MAX_HISTORY_FETCH)
		: HISTORY_PAGE_SIZE;
}
