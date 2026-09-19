import type { IsoDate } from '../date/isoDate';

/**
 * An Event describes a fact or a date, e.g. "Leasing ends 2028-08-31". It
 * never describes something the user must do (that is an Action).
 *
 * An event has no offset of its own: it is a named alias for the value of
 * one date Field on the same cycle. Actions reference the *event key*
 * rather than the field key directly, so a playbook can rewire which
 * field feeds an event without touching any action definition.
 */
export interface Event {
	id: string;
	cycleId: string;
	eventKey: string;
	label: string;
	sourceFieldKey: string;
	/** The current value of the source field, or null while it is empty. */
	resolvedDate: IsoDate | null;
	position: number;
}
