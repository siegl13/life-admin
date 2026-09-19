import { describe, expect, it } from 'vitest';
import { filterAdditionalSuggestions } from './filterAdditionalSuggestions';
import type { ExtractionFieldDefinition } from './extraction';

const EXISTING_FIELDS: ExtractionFieldDefinition[] = [
	{ fieldKey: 'annual_km', label: 'Jahreskilometer', type: 'text' }
];

describe('filterAdditionalSuggestions', () => {
	it('keeps a valid text suggestion', () => {
		const { kept, discarded } = filterAdditionalSuggestions(
			[{ suggestedLabel: 'Fahrzeugmodell', suggestedType: 'text', value: 'CUPRA Born' }],
			EXISTING_FIELDS
		);
		expect(kept).toEqual([
			{ suggestedLabel: 'Fahrzeugmodell', suggestedType: 'text', value: 'CUPRA Born' }
		]);
		expect(discarded).toEqual([]);
	});

	it('keeps a valid date suggestion', () => {
		const { kept } = filterAdditionalSuggestions(
			[{ suggestedLabel: 'Vertragsbeginn', suggestedType: 'date', value: '2024-06-01' }],
			EXISTING_FIELDS
		);
		expect(kept).toHaveLength(1);
		expect(kept[0].suggestedType).toBe('date');
	});

	it('keeps a valid currency suggestion', () => {
		const { kept } = filterAdditionalSuggestions(
			[{ suggestedLabel: 'Monatliche Rate', suggestedType: 'currency', value: '351.00 EUR' }],
			EXISTING_FIELDS
		);
		expect(kept).toHaveLength(1);
		expect(kept[0].value).toBe('351.00 EUR');
	});

	it('discards a suggestion with an unsupported type', () => {
		const { kept, discarded } = filterAdditionalSuggestions(
			[
				{
					suggestedLabel: 'Priorität',
					// @ts-expect-error deliberately invalid — a provider bypassing the schema
					suggestedType: 'priority',
					value: 'hoch'
				}
			],
			EXISTING_FIELDS
		);
		expect(kept).toEqual([]);
		expect(discarded).toEqual([{ suggestedLabel: 'Priorität', reason: 'UNSUPPORTED_TYPE' }]);
	});

	it('discards an invalid currency value (missing code)', () => {
		const { kept, discarded } = filterAdditionalSuggestions(
			[{ suggestedLabel: 'Rate', suggestedType: 'currency', value: '351.00' }],
			EXISTING_FIELDS
		);
		expect(kept).toEqual([]);
		expect(discarded).toEqual([{ suggestedLabel: 'Rate', reason: 'INVALID_CURRENCY' }]);
	});

	it('discards an invalid date value', () => {
		const { discarded } = filterAdditionalSuggestions(
			[{ suggestedLabel: 'Termin', suggestedType: 'date', value: '31.12.2027' }],
			EXISTING_FIELDS
		);
		expect(discarded).toEqual([{ suggestedLabel: 'Termin', reason: 'INVALID_DATE' }]);
	});

	it('caps the number of kept suggestions at the conservative maximum', () => {
		const many = Array.from({ length: 35 }, (_, i) => ({
			suggestedLabel: `Angabe ${i}`,
			suggestedType: 'text' as const,
			value: `Wert ${i}`
		}));
		const { kept, discarded } = filterAdditionalSuggestions(many, EXISTING_FIELDS);
		expect(kept).toHaveLength(30);
		expect(discarded.filter((d) => d.reason === 'OVER_LIMIT')).toHaveLength(5);
	});

	it('discards a suggestion whose label already matches an existing field, case/whitespace-insensitively', () => {
		const { kept, discarded } = filterAdditionalSuggestions(
			[{ suggestedLabel: '  jahresKILOMETER ', suggestedType: 'text', value: '10000' }],
			EXISTING_FIELDS
		);
		expect(kept).toEqual([]);
		expect(discarded).toEqual([
			{ suggestedLabel: 'jahresKILOMETER', reason: 'DUPLICATE_OF_EXISTING_FIELD' }
		]);
	});

	it('does not catch a semantic (not textual) duplicate — that is the model prompt’s job', () => {
		// "Jährliche Fahrleistung" means the same thing as "Jahreskilometer"
		// but is not a textual match — server-side dedup is deliberately not
		// a semantic-similarity model (see filterAdditionalSuggestions.ts).
		const { kept } = filterAdditionalSuggestions(
			[{ suggestedLabel: 'Jährliche Fahrleistung', suggestedType: 'text', value: '10000 km' }],
			EXISTING_FIELDS
		);
		expect(kept).toHaveLength(1);
	});

	it('discards a duplicate among the suggestions themselves, keeping the first', () => {
		const { kept, discarded } = filterAdditionalSuggestions(
			[
				{ suggestedLabel: 'Händler', suggestedType: 'text', value: 'Autohaus A' },
				{ suggestedLabel: 'Händler', suggestedType: 'text', value: 'Autohaus B' }
			],
			EXISTING_FIELDS
		);
		expect(kept).toEqual([
			{ suggestedLabel: 'Händler', suggestedType: 'text', value: 'Autohaus A' }
		]);
		expect(discarded).toEqual([{ suggestedLabel: 'Händler', reason: 'DUPLICATE' }]);
	});

	it('discards an empty label or empty value', () => {
		const { kept, discarded } = filterAdditionalSuggestions(
			[
				{ suggestedLabel: '  ', suggestedType: 'text', value: 'x' },
				{ suggestedLabel: 'Leer', suggestedType: 'text', value: '  ' }
			],
			EXISTING_FIELDS
		);
		expect(kept).toEqual([]);
		expect(discarded.map((d) => d.reason)).toEqual(['EMPTY_LABEL', 'EMPTY_VALUE']);
	});
});
