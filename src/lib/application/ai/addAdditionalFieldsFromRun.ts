import { FieldLabelRequiredError } from '../items/addCustomField';
import {
	InvalidCurrencyValueError,
	InvalidDateValueError,
	validateAndNormalizeFieldValue
} from '../items/updateItemFields';
import { ExtractionRunNotFoundError } from './applyExtractionRun';
import type { AddAdditionalFieldSelection, ExtractionRunRepositoryPort } from './ports';

export {
	ExtractionRunNotFoundError,
	FieldLabelRequiredError,
	InvalidDateValueError,
	InvalidCurrencyValueError
};

/** One suggestion as chosen (and possibly renamed/retyped) by the user on
 *  the review page, before validation. `value`/`currencyCode` are the raw
 *  form-level pieces — see `FieldValueUpdate` in updateItemFields.ts for
 *  why currency needs a separate code. */
export interface AddAdditionalFieldSelectionInput {
	suggestionId: string;
	label: string;
	type: AddAdditionalFieldSelection['type'];
	value: string | null;
	currencyCode?: string | null;
}

export interface AddAdditionalFieldsFromRunInput {
	itemId: string;
	runId: string;
	selections: readonly AddAdditionalFieldSelectionInput[];
}

/**
 * Turns a set of chosen additional suggestions into ordinary CUSTOM
 * fields, atomically (AI Extraction 1.1, section 6/7): validates every
 * selection with the exact same `validateAndNormalizeFieldValue` a
 * hand-typed field update goes through — there is no `Field` to look a
 * type up on yet (the field doesn't exist), so the type the user picked
 * on the review page is what gets validated against. Once this returns,
 * the created field is a completely normal Custom Field: no `AI_FIELD`
 * concept, no special review-only state — future edits/removal go
 * through the same "Angaben verwalten" flow as any other custom field.
 */
export interface AddAdditionalFieldsFromRunResult {
	addedCount: number;
}

export function addAdditionalFieldsFromRun(
	ports: { runs: ExtractionRunRepositoryPort },
	input: AddAdditionalFieldsFromRunInput
): AddAdditionalFieldsFromRunResult {
	const run = ports.runs.getById(input.runId);
	if (!run || run.itemId !== input.itemId) throw new ExtractionRunNotFoundError();

	const selections = input.selections.map((selection) => {
		const label = selection.label.trim();
		if (!label) throw new FieldLabelRequiredError();

		const value = validateAndNormalizeFieldValue(
			selection.suggestionId,
			selection.type,
			selection.value,
			selection.currencyCode
		);
		return { suggestionId: selection.suggestionId, label, type: selection.type, value };
	});

	ports.runs.addAdditionalFields({
		runId: run.id,
		itemId: run.itemId,
		cycleId: run.cycleId,
		selections
	});

	return { addedCount: selections.length };
}
