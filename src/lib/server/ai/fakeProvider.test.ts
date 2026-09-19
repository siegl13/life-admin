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

describe('fakeProvider (deterministic suggestions)', () => {
	it('produces valid suggestions plus documented invalid, duplicate, and unknown junk', async () => {
		const result = await fakeProvider.extract(request());
		const { kept, discarded } = filterSuggestions(result.suggestions, FIELDS);
		expect(result.suggestions).toContainEqual({
			fieldKey: 'notice_date',
			value: '31.12.2031'
		});

		expect(kept).toEqual([
			{ fieldKey: 'contract_end', value: '2031-03-15' },
			{ fieldKey: 'notice_date', value: '2031-03-15' },
			{ fieldKey: 'note', value: 'Beispielwert Note' }
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
