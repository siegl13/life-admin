import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Field } from '$lib/domain/field/field';
import { planNextCycleFields } from '$lib/domain/cycle/rollover';
import { materializePlaybook, type MaterializationPlan } from '$lib/domain/playbook/materialize';
import { parsePlaybookSnapshot } from '$lib/domain/playbook/snapshot';
import { openDatabase } from '$lib/server/db/database';
import { listActions } from '$lib/server/db/repositories/actionRepository';
import { listFields } from '$lib/server/db/repositories/fieldRepository';
import { createItem } from '$lib/server/db/repositories/itemRepository';
import { loadPlaybookCatalog } from './catalog';

const BUNDLED_DIR = path.join(process.cwd(), 'playbooks', 'bundled');
const NO_CUSTOM_DIR = path.join(BUNDLED_DIR, '..', 'no-custom-dir');
const REVIEWED_IDS = [
	'de.vehicle.tuv',
	'de.contract.electricity',
	'de.vehicle.leasing',
	'de.travel.booking',
	'de.home.maintenance'
] as const;

interface ExpectedField {
	key: string;
	type: 'text' | 'date' | 'currency';
	recommended: boolean;
	carryForward: boolean;
}

interface ExpectedAction {
	key: string;
	event?: string;
	offset?: Record<string, number>;
	dependsOn?: string[];
}

const CONTRACTS: Record<
	(typeof REVIEWED_IDS)[number],
	{ name: string; fields: ExpectedField[]; actions: ExpectedAction[] }
> = {
	'de.vehicle.tuv': {
		name: 'TÜV / Hauptuntersuchung',
		fields: [
			{ key: 'license_plate', type: 'text', recommended: true, carryForward: true },
			{ key: 'vehicle', type: 'text', recommended: false, carryForward: true },
			{ key: 'vin', type: 'text', recommended: false, carryForward: true },
			{ key: 'next_inspection', type: 'date', recommended: true, carryForward: false },
			{
				key: 'inspection_organization',
				type: 'text',
				recommended: false,
				carryForward: true
			}
		],
		actions: [
			{ key: 'plan_inspection', event: 'inspection_due', offset: { months: -1 } },
			{
				key: 'prepare_vehicle',
				event: 'inspection_due',
				offset: { weeks: -2 },
				dependsOn: ['plan_inspection']
			},
			{
				key: 'complete_inspection',
				event: 'inspection_due',
				offset: {},
				dependsOn: ['prepare_vehicle']
			},
			{ key: 'record_next_inspection', dependsOn: ['complete_inspection'] }
		]
	},
	'de.contract.electricity': {
		name: 'Stromvertrag',
		fields: [
			{ key: 'provider', type: 'text', recommended: true, carryForward: true },
			{ key: 'customer_number', type: 'text', recommended: false, carryForward: true },
			{ key: 'contract_end', type: 'date', recommended: true, carryForward: false },
			{ key: 'notice_period', type: 'text', recommended: false, carryForward: false },
			{ key: 'meter_number', type: 'text', recommended: true, carryForward: true },
			{ key: 'market_location_id', type: 'text', recommended: false, carryForward: true },
			{ key: 'annual_consumption', type: 'text', recommended: false, carryForward: false },
			{ key: 'tariff_name', type: 'text', recommended: false, carryForward: false },
			{ key: 'energy_price', type: 'text', recommended: false, carryForward: false },
			{ key: 'base_price', type: 'currency', recommended: false, carryForward: false },
			{ key: 'monthly_payment', type: 'currency', recommended: false, carryForward: false }
		],
		actions: [
			{ key: 'check_tariff', event: 'contract_ends', offset: { months: -3 } },
			{ key: 'compare_offers', dependsOn: ['check_tariff'] },
			{ key: 'decide_change', dependsOn: ['compare_offers'] },
			{
				key: 'complete_change',
				event: 'contract_ends',
				offset: { weeks: -6 },
				dependsOn: ['decide_change']
			},
			{ key: 'record_new_contract', dependsOn: ['complete_change'] }
		]
	},
	'de.vehicle.leasing': {
		name: 'Kfz-Leasing',
		fields: [
			{ key: 'lessor', type: 'text', recommended: true, carryForward: true },
			{ key: 'contract_number', type: 'text', recommended: true, carryForward: true },
			{ key: 'vehicle', type: 'text', recommended: true, carryForward: true },
			{ key: 'license_plate', type: 'text', recommended: false, carryForward: true },
			{ key: 'lease_end', type: 'date', recommended: true, carryForward: false },
			{ key: 'contract_term', type: 'text', recommended: false, carryForward: false },
			{ key: 'annual_mileage', type: 'text', recommended: false, carryForward: false },
			{ key: 'mileage', type: 'text', recommended: false, carryForward: false },
			{ key: 'monthly_rate', type: 'currency', recommended: false, carryForward: false },
			{ key: 'special_payment', type: 'currency', recommended: false, carryForward: false },
			{
				key: 'excess_mileage_rate',
				type: 'text',
				recommended: false,
				carryForward: false
			},
			{
				key: 'unused_mileage_rate',
				type: 'text',
				recommended: false,
				carryForward: false
			},
			{
				key: 'dealer_return_location',
				type: 'text',
				recommended: false,
				carryForward: true
			}
		],
		actions: [
			{ key: 'plan_replacement', event: 'lease_ends', offset: { months: -9 } },
			{
				key: 'check_mileage',
				event: 'lease_ends',
				offset: { months: -6 },
				dependsOn: ['plan_replacement']
			},
			{
				key: 'check_return_condition',
				event: 'lease_ends',
				offset: { months: -2 },
				dependsOn: ['check_mileage']
			},
			{
				key: 'arrange_return',
				event: 'lease_ends',
				offset: { months: -1 },
				dependsOn: ['check_return_condition']
			},
			{
				key: 'prepare_return',
				event: 'lease_ends',
				offset: { weeks: -1 },
				dependsOn: ['arrange_return']
			},
			{
				key: 'return_vehicle',
				event: 'lease_ends',
				offset: {},
				dependsOn: ['prepare_return']
			},
			{ key: 'review_return_documents', dependsOn: ['return_vehicle'] }
		]
	},
	'de.travel.booking': {
		name: 'Reisebuchung',
		fields: [
			{ key: 'destination', type: 'text', recommended: true, carryForward: false },
			{ key: 'provider', type: 'text', recommended: false, carryForward: false },
			{ key: 'booking_number', type: 'text', recommended: true, carryForward: false },
			{ key: 'trip_start', type: 'date', recommended: true, carryForward: false },
			{ key: 'trip_end', type: 'date', recommended: false, carryForward: false },
			{ key: 'balance_due_date', type: 'date', recommended: false, carryForward: false },
			{ key: 'balance_amount', type: 'currency', recommended: false, carryForward: false },
			{
				key: 'free_cancellation_until',
				type: 'date',
				recommended: false,
				carryForward: false
			},
			{ key: 'total_price', type: 'currency', recommended: false, carryForward: false },
			{ key: 'insurance_number', type: 'text', recommended: false, carryForward: false }
		],
		actions: [
			{ key: 'check_cancellation_deadline', event: 'cancellation_deadline', offset: {} },
			{ key: 'pay_balance', event: 'balance_due', offset: {} },
			{ key: 'check_travel_documents', event: 'trip_starts', offset: { weeks: -4 } },
			{
				key: 'prepare_check_in',
				event: 'trip_starts',
				offset: { weeks: -1 },
				dependsOn: ['check_travel_documents']
			}
		]
	},
	'de.home.maintenance': {
		name: 'Wartung & Prüfung',
		fields: [
			{ key: 'equipment', type: 'text', recommended: false, carryForward: true },
			{ key: 'manufacturer', type: 'text', recommended: false, carryForward: true },
			{ key: 'model', type: 'text', recommended: false, carryForward: true },
			{ key: 'serial_number', type: 'text', recommended: false, carryForward: true },
			{ key: 'location', type: 'text', recommended: false, carryForward: true },
			{ key: 'service_provider', type: 'text', recommended: false, carryForward: true },
			{
				key: 'customer_contract_number',
				type: 'text',
				recommended: false,
				carryForward: true
			},
			{ key: 'last_maintenance', type: 'date', recommended: false, carryForward: false },
			{ key: 'next_maintenance', type: 'date', recommended: true, carryForward: false },
			{
				key: 'maintenance_interval',
				type: 'text',
				recommended: false,
				carryForward: true
			},
			{ key: 'cost', type: 'currency', recommended: false, carryForward: false }
		],
		actions: [
			{ key: 'plan_maintenance', event: 'maintenance_due', offset: { months: -1 } },
			{ key: 'arrange_appointment', dependsOn: ['plan_maintenance'] },
			{
				key: 'complete_maintenance',
				event: 'maintenance_due',
				offset: {},
				dependsOn: ['arrange_appointment']
			},
			{ key: 'file_results', dependsOn: ['complete_maintenance'] },
			{ key: 'record_next_maintenance', dependsOn: ['file_results'] }
		]
	}
};

function reviewedEntries() {
	const catalog = loadPlaybookCatalog(BUNDLED_DIR, NO_CUSTOM_DIR);
	return {
		catalog,
		entries: REVIEWED_IDS.map((id) => {
			const entry = catalog.entries.find((candidate) => candidate.playbook.id === id);
			if (!entry) throw new Error(`missing bundled playbook ${id}`);
			return entry;
		})
	};
}

describe('bundled playbooks (golden path)', () => {
	it('all bundled playbooks pass the hardened loader and materialize valid snapshots', () => {
		const catalog = loadPlaybookCatalog(BUNDLED_DIR, NO_CUSTOM_DIR);
		expect(catalog.errors).toEqual([]);
		expect(catalog.entries.map((entry) => entry.playbook.id).sort()).toEqual([
			'de.contract.electricity',
			'de.finance.nv-certificate',
			'de.home.maintenance',
			'de.travel.booking',
			'de.vehicle.leasing',
			'de.vehicle.tuv'
		]);

		for (const entry of catalog.entries) {
			expect(parsePlaybookSnapshot(entry.playbook).ok).toBe(true);
			expect(() => materializePlaybook(entry.playbook)).not.toThrow();
		}
	});

	it.each(REVIEWED_IDS)('%s matches its field and workflow contract', (id) => {
		const { entries } = reviewedEntries();
		const playbook = entries.find((entry) => entry.playbook.id === id)!.playbook;
		const plan = materializePlaybook(playbook);
		const expected = CONTRACTS[id];

		expect(playbook.labelI18n.de).toBe(expected.name);
		expect(
			plan.fields.map((field) => ({
				key: field.fieldKey,
				type: field.type,
				recommended: field.recommended,
				carryForward: field.carryForward
			}))
		).toEqual(expected.fields);
		expect(
			plan.actions.map((action) => ({
				key: action.actionKey,
				...(action.due.dueKind === 'DERIVED'
					? { event: action.due.dueEventKey, offset: action.due.dueOffset }
					: {}),
				...(action.dependsOnActionKeys.length > 0 ? { dependsOn: action.dependsOnActionKeys } : {})
			}))
		).toEqual(expected.actions);
	});

	it.each(REVIEWED_IDS)(
		'%s can create an item with only a title and leaves date-derived actions unresolved',
		(id) => {
			const db = openDatabase(':memory:');
			try {
				const { entries } = reviewedEntries();
				const playbook = entries.find((entry) => entry.playbook.id === id)!.playbook;
				const item = createItem(db, {
					title: `Incomplete ${id}`,
					note: null,
					playbook: {
						id: playbook.id,
						version: playbook.version,
						name: playbook.name,
						snapshot: playbook
					},
					materialization: materializePlaybook(playbook)
				});
				const cycle = db
					.prepare(`SELECT id FROM cycles WHERE item_id = ? AND status = 'ACTIVE'`)
					.get(item.id) as { id: string };

				expect(listFields(db, cycle.id).every((field) => field.value === null)).toBe(true);
				const derivedActions = listActions(db, cycle.id).filter(
					(action) => action.dueKind === 'DERIVED'
				);
				expect(derivedActions.length).toBeGreaterThan(0);
				expect(derivedActions.every((action) => action.dueDate === null)).toBe(true);
			} finally {
				db.close();
			}
		}
	);

	it.each(REVIEWED_IDS)('%s applies every explicit carry-forward decision', (id) => {
		const { entries } = reviewedEntries();
		const playbook = entries.find((entry) => entry.playbook.id === id)!.playbook;
		const plan = materializePlaybook(playbook);
		const previousFields: Field[] = plan.fields.map((field, position) => ({
			id: `field-${position}`,
			cycleId: 'cycle-1',
			fieldKey: field.fieldKey,
			label: field.label,
			type: field.type,
			origin: 'PLAYBOOK',
			recommended: field.recommended,
			position,
			value:
				field.type === 'currency' ? '10.00 EUR' : field.type === 'date' ? '2030-01-01' : 'value'
		}));
		const seeds = planNextCycleFields(plan, previousFields);

		for (const expectedField of CONTRACTS[id].fields) {
			const seed = seeds.find((candidate) => candidate.fieldKey === expectedField.key)!;
			expect(seed.value, expectedField.key).toBe(expectedField.carryForward ? 'value' : null);
		}
	});

	it('uses currency only for monetary amounts, not unit prices', () => {
		const { entries } = reviewedEntries();
		const plans = new Map<string, MaterializationPlan>(
			entries.map((entry) => [entry.playbook.id, materializePlaybook(entry.playbook)])
		);

		expect(
			plans.get('de.contract.electricity')!.fields.find((f) => f.fieldKey === 'energy_price')!.type
		).toBe('text');
		expect(
			plans.get('de.vehicle.leasing')!.fields.find((f) => f.fieldKey === 'excess_mileage_rate')!
				.type
		).toBe('text');
		for (const [id, keys] of [
			['de.contract.electricity', ['base_price', 'monthly_payment']],
			['de.vehicle.leasing', ['monthly_rate', 'special_payment']],
			['de.travel.booking', ['balance_amount', 'total_price']],
			['de.home.maintenance', ['cost']]
		] as const) {
			for (const key of keys) {
				expect(plans.get(id)!.fields.find((field) => field.fieldKey === key)!.type).toBe(
					'currency'
				);
			}
		}
	});

	it('contains no reviewed playbook id in production TypeScript or Svelte code', () => {
		function sourceFiles(directory: string): string[] {
			return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
				const entryPath = path.join(directory, entry.name);
				if (entry.isDirectory()) return sourceFiles(entryPath);
				return /\.(ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.test.ts')
					? [entryPath]
					: [];
			});
		}

		const productionSource = sourceFiles(path.join(process.cwd(), 'src'))
			.map((file) => fs.readFileSync(file, 'utf8'))
			.join('\n');
		for (const id of REVIEWED_IDS) expect(productionSource).not.toContain(id);
	});
});
