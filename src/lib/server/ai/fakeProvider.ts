import type {
	DocumentExtractionProviderPort,
	ExtractionActionSuggestion,
	ExtractionAdditionalSuggestion,
	ExtractionRequest,
	ExtractionResult
} from '$lib/application/ai/extraction';
import type {
	DocumentRoutingProviderPort,
	RoutingRequest,
	RoutingResult
} from '$lib/application/ai/routing';

const FAKE_DATE_VALUE = '2031-03-15';

/**
 * Deterministic, no network I/O, ignores the dummy API key entirely (it
 * never even reads config). Derives everything from the request, so it
 * works for any playbook with no per-domain knowledge, and produces the
 * exact suggestion mix the brief requires: a valid value for every real
 * field, an unknown field key, a duplicate, and (when there are two date
 * fields) an invalid date for a real field. E2E and integration tests can
 * then assert both "a real suggestion is acceptable" and "every kind of
 * injected junk is discarded, never applied" with no model nondeterminism.
 */
export const fakeProvider: DocumentExtractionProviderPort & DocumentRoutingProviderPort = {
	providerId: 'fake',
	modelId: 'fake-v1',
	async extract(request: ExtractionRequest): Promise<ExtractionResult> {
		const suggestions: { fieldKey: string; value: string }[] = [];

		const dateFields = request.fields.filter((field) => field.type === 'date');

		for (const field of request.fields) {
			suggestions.push({
				fieldKey: field.fieldKey,
				value: field.type === 'date' ? FAKE_DATE_VALUE : `Beispielwert ${field.label}`
			});
		}

		suggestions.push({ fieldKey: 'unknown_field_from_model', value: 'Beispielwert' });
		const firstField = request.fields[0];
		if (firstField) {
			suggestions.push({ fieldKey: firstField.fieldKey, value: 'Doppelter Beispielwert' });
		}
		const invalidDateField = dateFields[1];
		if (invalidDateField) {
			suggestions.push({ fieldKey: invalidDateField.fieldKey, value: '31.12.2031' });
		}

		// AI Extraction 1.1: a fixed, valid mix (one per supported type) plus
		// one obvious duplicate of an existing field's label — deterministic
		// coverage of "a useful additional fact appears" and "server-side
		// dedup discards the obvious case" without any model nondeterminism.
		const additionalSuggestions: ExtractionAdditionalSuggestion[] = [
			{
				suggestedLabel: 'Zusätzliche Information',
				suggestedType: 'text',
				value: 'Randnotiz aus dem Dokument'
			},
			{ suggestedLabel: 'Weiterer Termin', suggestedType: 'date', value: '2032-06-01' },
			{ suggestedLabel: 'Monatliche Rate', suggestedType: 'currency', value: '351.00 EUR' }
		];
		if (firstField) {
			additionalSuggestions.push({
				suggestedLabel: firstField.label,
				suggestedType: 'text',
				value: 'Doppelte zusätzliche Information'
			});
		}

		// Document Action Suggestions: one absolute deadline, one availability
		// (never a deadline), one relative to the first date field when the
		// Item has one, and one already-done step that must be discarded.
		const anchorField = dateFields[0];
		const actionSuggestions: ExtractionActionSuggestion[] = [
			{
				title: 'Unterlagen prüfen',
				context: 'Vor dem Termin kontrollieren',
				evidence: 'Bitte prüfen Sie die Unterlagen bis zum 1. März 2031.',
				status: 'OPEN',
				date: { kind: 'DUE_BY', value: '2031-03-01', relative: null }
			},
			{
				title: 'Online-Portal nutzen',
				context: null,
				evidence: 'Das Portal steht ab dem 1. April 2031 zur Verfügung.',
				status: 'OPEN',
				date: { kind: 'AVAILABLE_FROM', value: '2031-04-01', relative: null }
			},
			{
				title: 'Bereits erledigter Schritt',
				context: null,
				evidence: null,
				status: 'ALREADY_DONE',
				date: { kind: 'NONE', value: null, relative: null }
			}
		];
		if (anchorField) {
			actionSuggestions.push({
				title: 'Termin bestätigen',
				context: null,
				evidence: 'Bitte bestätigen Sie den Termin 2 Wochen vorher.',
				status: 'OPEN',
				date: {
					kind: 'DUE_BY',
					value: null,
					relative: {
						relation: 'BEFORE',
						amount: 2,
						unit: 'WEEKS',
						anchorFieldKey: anchorField.fieldKey
					}
				}
			});
		}

		return {
			providerId: 'fake',
			modelId: 'fake-v1',
			suggestions,
			additionalSuggestions,
			actionSuggestions
		};
	},
	async route(_request: RoutingRequest): Promise<RoutingResult> {
		return {
			providerId: 'fake',
			modelId: 'fake-v1',
			documentKind: 'document',
			playbookMatchingHints: ['Electricity contract'],
			itemMatchingHints: ['document']
		};
	}
};
