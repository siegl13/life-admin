export type CycleStatus = 'ACTIVE' | 'COMPLETED';

/**
 * A Cycle is one pass through an Item's fields/events/actions. Exactly one
 * ACTIVE cycle exists per item (enforced by a DB partial unique index).
 *
 * There is still no automatic recurrence: a cycle is never closed or
 * rolled over by a timer or a background job. Slice 8 (see docs/adr/0010)
 * adds an explicit, user-initiated rollover ("Neuer Zyklus") once the
 * active cycle's actions are all finished — completed cycles stay
 * readable forever under "Verlauf" and are never editable again.
 */
export interface Cycle {
	id: string;
	itemId: string;
	sequence: number;
	status: CycleStatus;
	createdAt: string;
	playbookVersion?: string | null;
	completedAt?: string | null;
}
