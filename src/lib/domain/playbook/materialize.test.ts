import { describe, expect, it } from 'vitest';
import { normalizePlaybook } from './normalize';
import { parsePlaybookStructure } from './schema';
import { emptyMaterializationPlan, materializePlaybook } from './materialize';

function normalized(doc: unknown) {
	const parsed = parsePlaybookStructure(doc);
	if (!parsed.success) throw new Error('fixture failed validation');
	return normalizePlaybook(parsed.data);
}

describe('materializePlaybook', () => {
	it('turns a date field + event + derived action into a materialization plan', () => {
		const playbook = normalized({
			schemaVersion: 1,
			id: 'de.finance.nv-certificate',
			version: '1.0.0',
			name: 'NV certificate',
			fields: [{ key: 'valid_until', type: 'date', label: 'Valid until', recommended: true }],
			events: [{ key: 'expiry', label: 'Expiry', sourceField: 'valid_until' }],
			actions: [
				{
					key: 'request_new',
					label: 'Request new',
					due: { event: 'expiry', offset: { months: -2 } }
				}
			]
		});

		const plan = materializePlaybook(playbook);

		expect(plan.fields).toEqual([
			{
				fieldKey: 'valid_until',
				label: 'Valid until',
				labelI18n: {},
				type: 'date',
				origin: 'PLAYBOOK',
				recommended: true,
				position: 0
			}
		]);
		expect(plan.events).toEqual([
			{
				eventKey: 'expiry',
				label: 'Expiry',
				labelI18n: {},
				sourceFieldKey: 'valid_until',
				position: 0
			}
		]);
		expect(plan.actions).toEqual([
			{
				actionKey: 'request_new',
				label: 'Request new',
				labelI18n: {},
				description: null,
				due: { dueKind: 'DERIVED', dueEventKey: 'expiry', dueOffset: { months: -2 } },
				dependsOnActionKeys: [],
				position: 0
			}
		]);
	});

	it('plans initial groups in declaration order and assigns fields to them', () => {
		const playbook = normalized({
			schemaVersion: 1,
			id: 'de.test.grouped',
			version: '1.0.0',
			name: 'Grouped',
			groups: [
				{ key: 'second', label: ' Second ', label_i18n: { de: 'Zweite' } },
				{ key: 'first', label: 'First' }
			],
			fields: [
				{ key: 'a', type: 'text', label: 'A', group: 'first' },
				{ key: 'b', type: 'text', label: 'B' },
				{ key: 'c', type: 'text', label: 'C', group: 'second' }
			]
		});

		const plan = materializePlaybook(playbook);

		expect(plan.groups).toEqual([
			{ groupKey: 'second', label: 'Second', labelI18n: { de: 'Zweite' }, position: 0 },
			{ groupKey: 'first', label: 'First', labelI18n: {}, position: 1 }
		]);
		expect(plan.fields.map((f) => [f.fieldKey, f.groupKey])).toEqual([
			['a', 'first'],
			['b', undefined],
			['c', 'second']
		]);
	});

	it('plans no groups for a playbook without groups, and for a snapshot frozen before groups existed', () => {
		const withoutGroups = normalized({
			schemaVersion: 1,
			id: 'de.test.plain',
			version: '1.0.0',
			name: 'Plain',
			fields: [{ key: 'a', type: 'text', label: 'A' }]
		});
		const legacySnapshot = { ...withoutGroups };
		delete legacySnapshot.groups;

		expect(materializePlaybook(withoutGroups).groups).toEqual([]);
		expect(materializePlaybook(legacySnapshot).groups).toEqual([]);
		expect(materializePlaybook(legacySnapshot).fields[0].groupKey).toBeUndefined();
	});

	it('carries label_i18n through unresolved (resolution happens at the application layer)', () => {
		const playbook = normalized({
			schemaVersion: 1,
			id: 'de.finance.nv-certificate',
			version: '1.0.0',
			name: 'NV certificate',
			actions: [{ key: 'a', label: 'Request new', label_i18n: { de: 'Neu beantragen' } }]
		});
		const plan = materializePlaybook(playbook);
		expect(plan.actions[0].labelI18n).toEqual({ de: 'Neu beantragen' });
	});

	it('gives an undated workflow action due kind NONE', () => {
		const playbook = normalized({
			schemaVersion: 1,
			id: 'de.finance.nv-certificate',
			version: '1.0.0',
			name: 'NV certificate',
			actions: [{ key: 'check_receipt', label: 'Check receipt', dependsOn: [] }]
		});
		const plan = materializePlaybook(playbook);
		expect(plan.actions[0].due).toEqual({ dueKind: 'NONE' });
	});

	it('carries dependsOn action keys through', () => {
		const playbook = normalized({
			schemaVersion: 1,
			id: 'de.finance.nv-certificate',
			version: '1.0.0',
			name: 'NV certificate',
			actions: [
				{ key: 'a', label: 'A' },
				{ key: 'b', label: 'B', dependsOn: ['a'] }
			]
		});
		const plan = materializePlaybook(playbook);
		expect(plan.actions[1].dependsOnActionKeys).toEqual(['a']);
	});
});

describe('emptyMaterializationPlan', () => {
	it('is empty on every collection (generic item with no playbook)', () => {
		expect(emptyMaterializationPlan()).toEqual({ fields: [], events: [], actions: [] });
	});
});
