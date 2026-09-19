export type ItemStatus = 'ACTIVE' | 'ARCHIVED';

/**
 * An Item is the only thing a user names directly ("NV-Bescheinigung Max",
 * "Electricity House", "Mallorca Trip"). Everything else (fields, events,
 * actions) exists only in the context of an Item's active Cycle.
 *
 * `playbookSnapshot` is the frozen, normalized playbook this item was
 * created from (or null for a generic item). It is never re-read from the
 * source YAML after creation: see docs/adr/0004.
 */
export interface Item {
	id: string;
	title: string;
	note: string | null;
	status: ItemStatus;
	playbookId: string | null;
	playbookVersion: string | null;
	playbookName: string | null;
	playbookSnapshot: unknown | null;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string | null;
	/** True only when the stored JSON in items.playbook_snapshot failed to
	 *  parse (corrupted or tampered data — see docs/adr/0003). In this case
	 *  playbookSnapshot is also null, but for a different reason than "this
	 *  item never had a playbook": callers that must tell the two apart
	 *  (rollover eligibility, the detail page's integrity notice) check
	 *  this flag first. See the Slice 8 review, finding 3. */
	playbookSnapshotCorrupted?: boolean;
}
