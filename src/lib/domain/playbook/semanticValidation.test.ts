import { describe, expect, it } from 'vitest';
import { parsePlaybookStructure } from './schema';
import { normalizePlaybook } from './normalize';
import { validatePlaybookSemantics } from './semanticValidation';

function parse(doc: unknown) {
	const result = parsePlaybookStructure(doc);
	if (!result.success)
		throw new Error('fixture failed structural validation: ' + result.error.message);
	return result.data;
}

function base(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1,
		id: 'de.finance.nv-certificate',
		version: '1.0.0',
		name: 'NV certificate',
		fields: [{ key: 'valid_until', type: 'date', label: 'Valid until' }],
		events: [{ key: 'expiry', label: 'Expiry', sourceField: 'valid_until' }],
		actions: [
			{ key: 'request_new', label: 'Request new', due: { event: 'expiry', offset: { months: -2 } } }
		],
		...overrides
	};
}

describe('validatePlaybookSemantics', () => {
	it('accepts a well-formed playbook with no issues', () => {
		expect(validatePlaybookSemantics(parse(base()))).toEqual([]);
	});

	it('rejects an event sourced from a missing field', () => {
		const issues = validatePlaybookSemantics(
			parse(base({ events: [{ key: 'expiry', label: 'Expiry', sourceField: 'nope' }] }))
		);
		expect(issues.some((i) => i.message.includes('unknown field'))).toBe(true);
	});

	it('rejects an event sourced from a text field (must be a date field)', () => {
		const issues = validatePlaybookSemantics(
			parse(
				base({
					fields: [{ key: 'name', type: 'text', label: 'Name' }],
					events: [{ key: 'expiry', label: 'Expiry', sourceField: 'name' }]
				})
			)
		);
		expect(issues.some((i) => i.message.includes('not a date field'))).toBe(true);
	});

	it('rejects an action.due referencing an unknown event', () => {
		const issues = validatePlaybookSemantics(
			parse(
				base({ actions: [{ key: 'a', label: 'A', due: { event: 'nope', offset: { months: 1 } } }] })
			)
		);
		expect(issues.some((i) => i.message.includes('unknown event'))).toBe(true);
	});

	it('rejects a self-dependency', () => {
		const issues = validatePlaybookSemantics(
			parse(base({ actions: [{ key: 'a', label: 'A', dependsOn: ['a'] }] }))
		);
		expect(issues.some((i) => i.message.includes('depend on itself'))).toBe(true);
	});

	it('rejects a dependency on an unknown action', () => {
		const issues = validatePlaybookSemantics(
			parse(base({ actions: [{ key: 'a', label: 'A', dependsOn: ['ghost'] }] }))
		);
		expect(issues.some((i) => i.message.includes('unknown action'))).toBe(true);
	});

	it('rejects a 2-action dependency cycle', () => {
		const issues = validatePlaybookSemantics(
			parse(
				base({
					actions: [
						{ key: 'a', label: 'A', dependsOn: ['b'] },
						{ key: 'b', label: 'B', dependsOn: ['a'] }
					]
				})
			)
		);
		expect(issues.some((i) => i.message.includes('cycle'))).toBe(true);
	});

	it('rejects duplicate field keys', () => {
		const issues = validatePlaybookSemantics(
			parse(
				base({
					fields: [
						{ key: 'x', type: 'text', label: 'X1' },
						{ key: 'x', type: 'text', label: 'X2' }
					]
				})
			)
		);
		expect(issues.some((i) => i.message.includes('duplicate field key'))).toBe(true);
	});

	it('accepts a valid multi-step dependency chain (NV workflow shape)', () => {
		const issues = validatePlaybookSemantics(
			parse(
				base({
					actions: [
						{
							key: 'request_new',
							label: 'Request new',
							due: { event: 'expiry', offset: { months: -2 } }
						},
						{ key: 'check_receipt', label: 'Check receipt', dependsOn: ['request_new'] },
						{ key: 'forward_to_banks', label: 'Forward to banks', dependsOn: ['check_receipt'] }
					]
				})
			)
		);
		expect(issues).toEqual([]);
	});

	it('also accepts a NormalizedPlaybook (Slice 8: pins the widened parameter type)', () => {
		expect(validatePlaybookSemantics(normalizePlaybook(parse(base())))).toEqual([]);
	});
});
