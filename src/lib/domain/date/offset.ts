/**
 * Calendar-aware relative offset, e.g. "9 months before" is
 * { months: -9 }, never { days: -270 }.
 *
 * At least one component must be present and non-zero, enforced by
 * playbook validation (see domain/playbook/schema.ts), not here.
 */
export interface Offset {
	years?: number;
	months?: number;
	weeks?: number;
	days?: number;
}

export function isZeroOffset(offset: Offset): boolean {
	return !offset.years && !offset.months && !offset.weeks && !offset.days;
}
