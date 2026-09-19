import { isIsoDate } from '../../domain/date/isoDate';
import {
	formatCurrencyStorageValue,
	isValidCurrencyStorageValue,
	type Field,
	type FieldType
} from '../../domain/field/field';
import type { CycleRepositoryPort, FieldRepositoryPort, ScheduleRepositoryPort } from '../ports';

export class ItemHasNoActiveCycleError extends Error {
	constructor(itemId: string) {
		super(`Item has no active cycle: ${itemId}`);
		this.name = 'ItemHasNoActiveCycleError';
	}
}

export class UnknownFieldError extends Error {
	constructor(fieldKey: string) {
		super(`Unknown field: ${fieldKey}`);
		this.name = 'UnknownFieldError';
	}
}

export class InvalidDateValueError extends Error {
	constructor(fieldKey: string, value: string) {
		super(`Field "${fieldKey}" expects an ISO date (YYYY-MM-DD), got: ${value}`);
		this.name = 'InvalidDateValueError';
	}
}

export class InvalidCurrencyValueError extends Error {
	constructor(fieldKey: string) {
		super(`Field "${fieldKey}" expects a decimal amount and a 3-letter ISO 4217 currency code`);
		this.name = 'InvalidCurrencyValueError';
	}
}

export interface FieldValueUpdate {
	fieldKey: string;
	/** An empty string is treated the same as null: clearing a field is always allowed.
	 *  For a `currency` field this is the raw decimal amount, not the final
	 *  stored string — see `currencyCode` below. */
	value: string | null;
	/** Only read (and required, once `value` is non-empty) when the field's
	 *  type is `currency`: combined with `value` into the canonical stored
	 *  string here, so a hand-typed amount+code and an accepted AI
	 *  suggestion's currency value go through the exact same validation. */
	currencyCode?: string | null;
}

export interface UpdateItemFieldsInput {
	itemId: string;
	updates: FieldValueUpdate[];
}

/**
 * The one place a raw (fieldKey, type, value[, currencyCode]) tuple
 * becomes a validated, storage-ready value — used both by
 * `normalizeFieldUpdates` below (an existing field) and by
 * `application/ai/addAdditionalFieldsFromRun.ts` (a field that doesn't
 * exist yet, so there is no `Field` object to look a type up on; the
 * caller already knows the type the user picked). One validation
 * algorithm regardless of which of the three ever calls it.
 */
export function validateAndNormalizeFieldValue(
	fieldKey: string,
	type: FieldType,
	rawValue: string | null | undefined,
	currencyCode?: string | null
): string | null {
	const trimmed = rawValue?.trim() ?? null;
	const value = trimmed === '' ? null : trimmed;

	if (type === 'currency') {
		if (value === null) return null;
		// Two distinct shapes reach here: a hand-typed amount + separately
		// selected currency code (`currencyCode` is set — the field form, and
		// an additional-suggestion row), and an accepted *known-field* AI
		// suggestion, whose value already comes pre-formatted as the full
		// canonical string ("45.00 EUR") straight out of the run's stored
		// suggestion — see applyExtractionRun.ts, which never had an amount
		// and code to split in the first place. Re-running the latter through
		// formatCurrencyStorageValue would treat "45.00 EUR" as a bare amount
		// and always fail.
		if (currencyCode === undefined) {
			if (!isValidCurrencyStorageValue(value)) throw new InvalidCurrencyValueError(fieldKey);
			return value;
		}
		const stored = formatCurrencyStorageValue(value, currencyCode ?? '');
		if (stored === null) throw new InvalidCurrencyValueError(fieldKey);
		return stored;
	}

	if (type === 'date' && value !== null && !isIsoDate(value)) {
		throw new InvalidDateValueError(fieldKey, value);
	}

	return value;
}

/**
 * Validates a set of field value updates against a cycle's real fields:
 * unknown keys and non-ISO values for a `date` field are rejected exactly
 * the same way for a hand-typed value and for an accepted AI suggestion
 * (see application/ai/applyExtractionRun.ts, which is the other caller).
 * One validation algorithm, not two.
 */
export function normalizeFieldUpdates(
	fields: readonly Field[],
	updates: readonly FieldValueUpdate[]
): FieldValueUpdate[] {
	const fieldsByKey = new Map(fields.map((f) => [f.fieldKey, f]));

	return updates.map((update) => {
		const field = fieldsByKey.get(update.fieldKey);
		if (!field) throw new UnknownFieldError(update.fieldKey);

		const value = validateAndNormalizeFieldValue(
			update.fieldKey,
			field.type,
			update.value,
			update.currencyCode
		);
		return { fieldKey: update.fieldKey, value };
	});
}

/**
 * Writes a set of field values and recalculates every dependent event and
 * DERIVED action due date, atomically. Missing/blank values are always
 * accepted — a field being recommended never makes it mandatory to fill
 * in (progressive data entry).
 */
export function updateItemFields(
	ports: {
		cycles: CycleRepositoryPort;
		fields: FieldRepositoryPort;
		schedule: ScheduleRepositoryPort;
	},
	input: UpdateItemFieldsInput
): void {
	const cycle = ports.cycles.getActiveCycle(input.itemId);
	if (!cycle) throw new ItemHasNoActiveCycleError(input.itemId);

	const normalized = normalizeFieldUpdates(ports.fields.listFields(cycle.id), input.updates);

	ports.schedule.applyFieldUpdatesAndRecalculate(cycle.id, normalized);
}
