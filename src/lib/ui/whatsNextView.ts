import type { WhatsNextBucket, WhatsNextGroup } from '$lib/domain/whatsnext/whatsNext';

/**
 * Presentation-only projection of the What's Next working set for the
 * root page: which filter is active, how many actions exist per bucket,
 * and how groups split across sections. Never touches ranking or
 * availability — those stay entirely in buildWhatsNext(); this only
 * decides how its output is sliced into sections and counted.
 */

export type WhatsNextFilter = 'all' | 'overdue' | 'now' | 'later';

const FILTERS: readonly WhatsNextFilter[] = ['all', 'overdue', 'now', 'later'];

const BUCKET_OF_FILTER: Record<Exclude<WhatsNextFilter, 'all'>, WhatsNextBucket> = {
	overdue: 0,
	now: 1,
	later: 2
};

/** An unrecognized or missing `?filter=` value falls back to `all` —
 *  never 404s or throws on a stale/crafted link. */
export function parseWhatsNextFilter(raw: string | null): WhatsNextFilter {
	return (FILTERS as readonly string[]).includes(raw ?? '') ? (raw as WhatsNextFilter) : 'all';
}

export interface WhatsNextCounts {
	all: number;
	overdue: number;
	now: number;
	later: number;
}

/** Counts ACTIONS (not Items) across the full, unfiltered working set —
 *  a filter chip's count never changes just because another filter is
 *  currently selected. */
export function countWhatsNextActions(groups: readonly WhatsNextGroup[]): WhatsNextCounts {
	let overdue = 0;
	let now = 0;
	let later = 0;
	for (const group of groups) {
		for (const action of group.actions) {
			if (action.bucket === 0) overdue++;
			else if (action.bucket === 1) now++;
			else later++;
		}
	}
	return { all: overdue + now + later, overdue, now, later };
}

export interface WhatsNextSection {
	bucket: WhatsNextBucket;
	groups: WhatsNextGroup[];
}

/**
 * Splits groups into per-bucket sections and sorts dated actions by
 * ascending due date. Undated actions retain their working-set order
 * after the dated actions. In the `all` filter every
 * bucket is its own section, and the SAME Item can appear in more than
 * one section — once per bucket it has actions in, each action exactly
 * once, always inside its Item's group — because this is a deliberate
 * presentational regrouping, not the domain grouping itself (which stays
 * "one action, counted once" per buildWhatsNext()). A single-bucket
 * filter returns exactly that one section, even if empty, so the caller
 * can render a "nothing matches this filter" state.
 */
export function projectWhatsNextSections(
	groups: readonly WhatsNextGroup[],
	filter: WhatsNextFilter
): WhatsNextSection[] {
	const buckets: WhatsNextBucket[] = filter === 'all' ? [0, 1, 2] : [BUCKET_OF_FILTER[filter]];
	return buckets.map((bucket) => {
		const rows = groups.flatMap((group) =>
			group.actions
				.filter((action) => action.bucket === bucket)
				.map((action) => ({ group, action }))
		);
		rows.sort((left, right) => {
			if (left.action.dueDate === null) return right.action.dueDate === null ? 0 : 1;
			if (right.action.dueDate === null) return -1;
			return left.action.dueDate.localeCompare(right.action.dueDate);
		});

		return {
			bucket,
			groups: rows.map(({ group, action }) => ({ ...group, actions: [action] }))
		};
	});
}
