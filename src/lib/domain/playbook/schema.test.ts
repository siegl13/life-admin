import { describe, expect, it } from 'vitest';
import { parsePlaybookStructure } from './schema';

function validPlaybook(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1,
		id: 'de.finance.nv-certificate',
		version: '1.0.0',
		name: 'NV certificate',
		fields: [{ key: 'valid_until', type: 'date', label: 'Valid until', recommended: true }],
		events: [{ key: 'expiry', label: 'Expiry', sourceField: 'valid_until' }],
		actions: [
			{ key: 'request_new', label: 'Request new', due: { event: 'expiry', offset: { months: -2 } } }
		],
		...overrides
	};
}

describe('parsePlaybookStructure', () => {
	it('accepts a well-formed playbook', () => {
		const result = parsePlaybookStructure(validPlaybook());
		expect(result.success).toBe(true);
	});

	it('rejects an unsupported schemaVersion', () => {
		expect(parsePlaybookStructure(validPlaybook({ schemaVersion: 2 })).success).toBe(false);
	});

	it('rejects a malformed id', () => {
		expect(parsePlaybookStructure(validPlaybook({ id: 'NotValid' })).success).toBe(false);
		expect(parsePlaybookStructure(validPlaybook({ id: 'single' })).success).toBe(false);
	});

	it('rejects a non-semver version', () => {
		expect(parsePlaybookStructure(validPlaybook({ version: '1.0' })).success).toBe(false);
		expect(parsePlaybookStructure(validPlaybook({ version: 'v1.0.0' })).success).toBe(false);
	});

	it('a field without carryForward is valid, and one with carryForward: true is valid', () => {
		expect(
			parsePlaybookStructure(validPlaybook({ fields: [{ key: 'a', type: 'text', label: 'A' }] }))
				.success
		).toBe(true);
		expect(
			parsePlaybookStructure(
				validPlaybook({
					fields: [{ key: 'a', type: 'text', label: 'A', carryForward: true }]
				})
			).success
		).toBe(true);
	});

	it('rejects unknown top-level keys', () => {
		expect(parsePlaybookStructure(validPlaybook({ evilKey: 'rm -rf' })).success).toBe(false);
	});

	it('rejects an unsupported field type', () => {
		const doc = validPlaybook({
			fields: [{ key: 'x', type: 'number', label: 'X' }]
		});
		expect(parsePlaybookStructure(doc).success).toBe(false);
	});

	it('rejects a field/event/action key with a reserved prefix', () => {
		expect(
			parsePlaybookStructure(
				validPlaybook({ fields: [{ key: 'c_evil', type: 'text', label: 'X' }] })
			).success
		).toBe(false);
		expect(
			parsePlaybookStructure(validPlaybook({ actions: [{ key: 'm_evil', label: 'X' }] })).success
		).toBe(false);
	});

	it('defaults an omitted offset to zero ("due exactly at the event")', () => {
		const doc = validPlaybook({
			actions: [{ key: 'a', label: 'A', due: { event: 'expiry' } }]
		});
		const result = parsePlaybookStructure(doc);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.actions[0].due).toEqual({ event: 'expiry', offset: {} });
		}
	});

	it('rejects an offset with no components', () => {
		const doc = validPlaybook({
			actions: [{ key: 'a', label: 'A', due: { event: 'expiry', offset: {} } }]
		});
		expect(parsePlaybookStructure(doc).success).toBe(false);
	});

	it('rejects an offset component out of range', () => {
		const doc = validPlaybook({
			actions: [{ key: 'a', label: 'A', due: { event: 'expiry', offset: { months: 10000 } } }]
		});
		expect(parsePlaybookStructure(doc).success).toBe(false);
	});

	it('rejects more fields than the cardinality limit', () => {
		const fields = Array.from({ length: 51 }, (_, i) => ({
			key: `f${i}`,
			type: 'text',
			label: `Field ${i}`
		}));
		expect(parsePlaybookStructure(validPlaybook({ fields })).success).toBe(false);
	});

	it('rejects more than 10 dependencies on one action', () => {
		const dependsOn = Array.from({ length: 11 }, (_, i) => `dep${i}`);
		const doc = validPlaybook({ actions: [{ key: 'a', label: 'A', dependsOn }] });
		expect(parsePlaybookStructure(doc).success).toBe(false);
	});

	it('accepts label_i18n maps', () => {
		const doc = validPlaybook({
			label_i18n: { de: 'NV-Bescheinigung' },
			fields: [
				{ key: 'valid_until', type: 'date', label: 'Valid until', label_i18n: { de: 'Gültig bis' } }
			]
		});
		expect(parsePlaybookStructure(doc).success).toBe(true);
	});

	it('defaults fields/events/actions to empty arrays when absent', () => {
		const result = parsePlaybookStructure({
			schemaVersion: 1,
			id: 'de.test.minimal',
			version: '1.0.0',
			name: 'Minimal'
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.fields).toEqual([]);
			expect(result.data.events).toEqual([]);
			expect(result.data.actions).toEqual([]);
		}
	});
});
