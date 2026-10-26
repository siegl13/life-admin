import { describe, expect, it } from 'vitest';
import { fakeProvider } from './fakeProvider';
import { filterSuggestions } from '$lib/application/ai/filterSuggestions';
import type { ExtractionFieldDefinition, ExtractionRequest } from '$lib/application/ai/extraction';
import type { RoutingRequest } from '$lib/application/ai/routing';

const FIELDS: ExtractionFieldDefinition[] = [
	{ fieldKey: 'contract_end', label: 'Contract end', type: 'date' },
	{ fieldKey: 'notice_date', label: 'Notice date', type: 'date' },
	{ fieldKey: 'note', label: 'Note', type: 'text' }
];

function request(): ExtractionRequest {
	return {
		contract: 'CONTRACT',
		userInstruction: '',
		fields: FIELDS,
		document: { mimeType: 'application/pdf', bytes: new Uint8Array([1]) },
		timeoutMs: 60_000,
		maxOutputTokens: 2000
	};
}

describe('fakeProvider action suggestions', () => {
	it('returns a deadline, an availability, a relative date and an already-done step', async () => {
		const result = await fakeProvider.extract(request());
		const actions = result.actionSuggestions ?? [];
		expect(actions.map((a) => [a.title, a.date.kind, a.status])).toEqual([
			['Unterlagen prüfen', 'DUE_BY', 'OPEN'],
			['Online-Portal nutzen', 'AVAILABLE_FROM', 'OPEN'],
			['Bereits erledigter Schritt', 'NONE', 'ALREADY_DONE'],
			['Termin bestätigen', 'DUE_BY', 'OPEN']
		]);
		expect(actions[3]?.date.relative?.anchorFieldKey).toBe('contract_end');
	});

	it('does not turn the plain field values it returns into Actions', async () => {
		// Fixture only: shows the fake keeps facts (fields) and steps (Actions)
		// apart. It says nothing about how a real model classifies text.
		const result = await fakeProvider.extract(request());
		const factValues = new Set(result.suggestions.map((s) => s.value));
		for (const action of result.actionSuggestions ?? []) {
			expect(factValues.has(action.title)).toBe(false);
			expect(action.title).not.toMatch(/^\d/);
		}
	});

	it('omits the relative suggestion when the Item has no date field', async () => {
		const result = await fakeProvider.extract({ ...request(), fields: [FIELDS[2]!] });
		expect(result.actionSuggestions?.some((a) => a.date.relative)).toBe(false);
	});
});

describe('fakeProvider (deterministic suggestions)', () => {
	it('produces valid suggestions plus documented invalid, duplicate, and unknown junk', async () => {
		const result = await fakeProvider.extract(request());
		const { kept, discarded } = filterSuggestions(result.suggestions, FIELDS);
		expect(result.suggestions).toContainEqual({
			fieldKey: 'notice_date',
			value: '31.12.2031'
		});

		expect(kept).toEqual([
			{ fieldKey: 'contract_end', value: '2031-03-15', sourceText: 'Fiktive Belegstelle 1' },
			{ fieldKey: 'notice_date', value: '2031-03-15', sourceText: null },
			{ fieldKey: 'note', value: 'Beispielwert Note', sourceText: 'Fiktive Belegstelle 3' }
		]);

		expect(discarded.find((d) => d.fieldKey === 'unknown_field_from_model')?.reason).toBe(
			'UNKNOWN_FIELD'
		);
		expect(discarded).toContainEqual({ fieldKey: 'contract_end', reason: 'DUPLICATE' });
		expect(discarded).toContainEqual({ fieldKey: 'notice_date', reason: 'DUPLICATE' });
	});

	it('keeps the real date field resolved while discarding the unknown-key junk', async () => {
		const result = await fakeProvider.extract(request());
		const { kept } = filterSuggestions(result.suggestions, FIELDS);
		const contractEnd = kept.find((s) => s.fieldKey === 'contract_end');
		expect(contractEnd?.value).toBe('2031-03-15');
	});

	it('returns deterministic advisory routing text without local Playbook metadata', async () => {
		const request: RoutingRequest = {
			document: { mimeType: 'application/pdf', bytes: new Uint8Array([1]) },
			timeoutMs: 60_000,
			maxOutputTokens: 2000
		};

		await expect(fakeProvider.route(request)).resolves.toEqual({
			providerId: 'fake',
			modelId: 'fake-v1',
			documentKind: 'document',
			playbookMatchingHints: ['Electricity contract'],
			itemMatchingHints: ['document']
		});
	});
});
