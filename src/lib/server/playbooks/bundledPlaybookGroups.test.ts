import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupFields } from '$lib/domain/field/fieldGroup';
import { materializePlaybook } from '$lib/domain/playbook/materialize';
import { openDatabase } from '$lib/server/db/database';
import { listFields } from '$lib/server/db/repositories/fieldRepository';
import {
	listFieldGroupAssignments,
	listFieldGroups
} from '$lib/server/db/repositories/fieldGroupRepository';
import { createItem } from '$lib/server/db/repositories/itemRepository';
import { loadPlaybookCatalog } from './catalog';

const BUNDLED_DIR = path.join(process.cwd(), 'playbooks', 'bundled');
const NO_CUSTOM_DIR = path.join(BUNDLED_DIR, '..', 'no-custom-dir');

/**
 * Audit of every bundled Playbook: its initial groups (German label) and
 * the fields each one holds. Groups are initial organization only; an Item
 * owns them after creation.
 */
const EXPECTED_GROUPS: Record<string, { label: string; fields: string[] }[]> = {
	'de.travel.booking': [
		{ label: 'Reise', fields: ['destination', 'trip_start', 'trip_end'] },
		{ label: 'Buchung', fields: ['provider', 'booking_number', 'insurance_number'] },
		{
			label: 'Zahlung und Storno',
			fields: ['balance_due_date', 'balance_amount', 'free_cancellation_until', 'total_price']
		}
	],
	'de.vehicle.leasing': [
		{ label: 'Fahrzeug', fields: ['vehicle', 'license_plate'] },
		{
			label: 'Vertrag',
			fields: ['lessor', 'contract_number', 'lease_end', 'contract_term', 'dealer_return_location']
		},
		{ label: 'Zahlungen', fields: ['monthly_rate', 'special_payment'] },
		{
			label: 'Kilometer',
			fields: ['annual_mileage', 'mileage', 'excess_mileage_rate', 'unused_mileage_rate']
		}
	],
	'de.contract.electricity': [
		{
			label: 'Vertrag',
			fields: ['provider', 'customer_number', 'contract_end', 'notice_period']
		},
		{
			label: 'Zähler und Verbrauch',
			fields: ['meter_number', 'market_location_id', 'annual_consumption']
		},
		{
			label: 'Tarif und Kosten',
			fields: ['tariff_name', 'energy_price', 'base_price', 'monthly_payment']
		}
	],
	'de.vehicle.tuv': [
		{ label: 'Fahrzeug', fields: ['license_plate', 'vehicle', 'vin'] },
		{ label: 'Prüfung', fields: ['next_inspection', 'inspection_organization'] }
	],
	'de.home.maintenance': [
		{
			label: 'Anlage / Gerät',
			fields: ['equipment', 'manufacturer', 'model', 'serial_number', 'location']
		},
		{
			label: 'Dienstleister und Kosten',
			fields: ['service_provider', 'customer_contract_number', 'cost']
		},
		{
			label: 'Wartungsplan',
			fields: ['last_maintenance', 'next_maintenance', 'maintenance_interval']
		}
	],
	// Two fields only: one General group is already the clearest layout.
	'de.finance.nv-certificate': []
};

function bundled() {
	const catalog = loadPlaybookCatalog(BUNDLED_DIR, NO_CUSTOM_DIR);
	expect(catalog.errors).toEqual([]);
	return catalog.entries.map((entry) => entry.playbook);
}

describe('bundled playbook field groups', () => {
	it('audits every bundled playbook', () => {
		expect(
			bundled()
				.map((playbook) => playbook.id)
				.sort()
		).toEqual(Object.keys(EXPECTED_GROUPS).sort());
	});

	it.each(Object.keys(EXPECTED_GROUPS))('%s declares its audited groups', (id) => {
		const playbook = bundled().find((candidate) => candidate.id === id)!;
		const groups = playbook.groups ?? [];

		expect(
			groups.map((group) => ({
				label: group.labelI18n.de,
				fields: playbook.fields.filter((f) => f.group === group.key).map((f) => f.key)
			}))
		).toEqual(EXPECTED_GROUPS[id].map((group) => ({ ...group })));
		// Every group is used and every grouped field names a declared group.
		for (const group of groups) {
			expect(
				playbook.fields.some((f) => f.group === group.key),
				group.key
			).toBe(true);
		}
	});

	it.each(Object.keys(EXPECTED_GROUPS))(
		'%s seeds the item with these groups, General last and empty',
		(id) => {
			const db = openDatabase(':memory:');
			try {
				const playbook = bundled().find((candidate) => candidate.id === id)!;
				const item = createItem(db, {
					title: `Grouped ${id}`,
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

				const views = groupFields(
					listFieldGroups(db, item.id),
					listFieldGroupAssignments(db, item.id),
					listFields(db, cycle.id)
				);

				const expected = EXPECTED_GROUPS[id];
				expect(views.map((view) => view.group.label)).toEqual([
					// Unresolved plan labels (the base language), in declaration order.
					...(playbook.groups ?? []).map((group) => group.label),
					null
				]);
				expect(views.every((view) => !view.group.featured)).toBe(true);
				expect(views.slice(0, -1).map((view) => view.fields.map((f) => f.fieldKey))).toEqual(
					expected.map((group) => group.fields)
				);
				const general = views.at(-1)!;
				expect(general.group.isDefault).toBe(true);
				expect(general.fields).toEqual(expected.length === 0 ? listFields(db, cycle.id) : []);
			} finally {
				db.close();
			}
		}
	);
});
