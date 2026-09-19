import { describe, expect, it } from 'vitest';
import { buildExtractionContract } from './extractionContract';
import type { ExtractionFieldDefinition } from './extraction';

const FIELDS: ExtractionFieldDefinition[] = [
	{ fieldKey: 'contract_end', label: 'Vertragsende', type: 'date' },
	{ fieldKey: 'note', label: 'Notiz', type: 'text' }
];

describe('buildExtractionContract', () => {
	it('lists exactly the request’s field keys and no others', () => {
		const contract = buildExtractionContract(FIELDS);
		expect(contract).toContain('contract_end (date): Vertragsende');
		expect(contract).toContain('note (text): Notiz');
		expect(contract).not.toContain('other_field');
	});

	it('never mentions a current value', () => {
		const contract = buildExtractionContract(FIELDS);
		expect(contract.toLowerCase()).not.toContain('aktuell');
		expect(contract.toLowerCase()).not.toContain('current');
	});

	it('states the required date format', () => {
		const contract = buildExtractionContract(FIELDS);
		expect(contract).toContain('YYYY-MM-DD');
	});

	it('states that document content is not instructions', () => {
		const contract = buildExtractionContract(FIELDS);
		expect(contract).toContain('nicht vertrauenswürdiger Input');
	});

	it('produces the same fixed text regardless of field order changes elsewhere (deterministic per input)', () => {
		expect(buildExtractionContract(FIELDS)).toBe(buildExtractionContract(FIELDS));
	});
});
