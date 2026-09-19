import { describe, expect, it, vi } from 'vitest';
import type { Item } from '../../domain/item/item';
import type { NormalizedPlaybook } from '../../domain/playbook/normalize';
import type { ItemRepositoryPort, PlaybookCatalogPort } from '../ports';
import { createItem, TitleRequiredError, UnknownPlaybookError } from './createItem';

function fakeItemsPort(): ItemRepositoryPort & { created: unknown[] } {
	const created: unknown[] = [];
	return {
		created,
		createItem: vi.fn((input) => {
			created.push(input);
			return { id: 'new-id', title: input.title } as Item;
		}),
		getItemById: vi.fn(() => null),
		listItems: vi.fn(() => []),
		setItemStatus: vi.fn(() => {
			throw new Error('not used in this test');
		})
	};
}

const NV_PLAYBOOK: NormalizedPlaybook = {
	schemaVersion: 1,
	id: 'de.finance.nv-certificate',
	version: '1.0.0',
	name: 'NV certificate',
	labelI18n: {},
	description: null,
	locale: null,
	category: null,
	fields: [
		{
			key: 'valid_until',
			type: 'date',
			label: 'Valid until',
			labelI18n: {},
			recommended: true,
			position: 0
		}
	],
	events: [
		{ key: 'expiry', label: 'Expiry', labelI18n: {}, sourceField: 'valid_until', position: 0 }
	],
	actions: [
		{
			key: 'request_new',
			label: 'Request new',
			labelI18n: {},
			description: null,
			due: { event: 'expiry', offset: { months: -2 } },
			dependsOn: [],
			position: 0
		}
	]
};

function fakePlaybooksPort(playbooks: NormalizedPlaybook[] = []): PlaybookCatalogPort {
	return {
		findById: (id) => playbooks.find((p) => p.id === id) ?? null,
		list: () => playbooks
	};
}

describe('createItem (application use case)', () => {
	it('rejects a blank title before touching the repository', () => {
		const items = fakeItemsPort();
		expect(() => createItem({ items, playbooks: fakePlaybooksPort() }, { title: '   ' })).toThrow(
			TitleRequiredError
		);
		expect(items.createItem).not.toHaveBeenCalled();
	});

	it('creates a generic item (no playbookId) with an empty materialization plan', () => {
		const items = fakeItemsPort();
		createItem({ items, playbooks: fakePlaybooksPort() }, { title: 'Mallorca Trip' });

		expect(items.created).toHaveLength(1);
		const input = items.created[0] as { playbook: unknown; materialization: { fields: unknown[] } };
		expect(input.playbook).toBeNull();
		expect(input.materialization.fields).toEqual([]);
	});

	it('rejects an unknown playbookId', () => {
		const items = fakeItemsPort();
		expect(() =>
			createItem(
				{ items, playbooks: fakePlaybooksPort() },
				{ title: 'X', playbookId: 'de.does.not-exist' }
			)
		).toThrow(UnknownPlaybookError);
	});

	it('materializes and freezes the playbook onto the item when a valid playbookId is given', () => {
		const items = fakeItemsPort();
		createItem(
			{ items, playbooks: fakePlaybooksPort([NV_PLAYBOOK]) },
			{ title: 'NV-Bescheinigung Max', playbookId: 'de.finance.nv-certificate' }
		);

		const input = items.created[0] as {
			playbook: { id: string; version: string; snapshot: unknown } | null;
			materialization: { fields: unknown[]; events: unknown[]; actions: unknown[] };
		};
		expect(input.playbook).toEqual({
			id: 'de.finance.nv-certificate',
			version: '1.0.0',
			name: 'NV certificate',
			snapshot: NV_PLAYBOOK
		});
		expect(input.materialization.fields).toHaveLength(1);
		expect(input.materialization.events).toHaveLength(1);
		expect(input.materialization.actions).toHaveLength(1);
	});

	it('resolves each field/event/action label to the current locale (German) before freezing the plan', () => {
		const playbookWithGerman: NormalizedPlaybook = {
			...NV_PLAYBOOK,
			fields: [{ ...NV_PLAYBOOK.fields[0], labelI18n: { de: 'Gültig bis' } }],
			events: [{ ...NV_PLAYBOOK.events[0], labelI18n: { de: 'Ablaufdatum' } }],
			actions: [{ ...NV_PLAYBOOK.actions[0], labelI18n: { de: 'Neu beantragen' } }]
		};
		const items = fakeItemsPort();
		createItem(
			{ items, playbooks: fakePlaybooksPort([playbookWithGerman]) },
			{ title: 'NV-Bescheinigung Max', playbookId: 'de.finance.nv-certificate' }
		);

		const input = items.created[0] as {
			materialization: {
				fields: { label: string }[];
				events: { label: string }[];
				actions: { label: string }[];
			};
		};
		expect(input.materialization.fields[0].label).toBe('Gültig bis');
		expect(input.materialization.events[0].label).toBe('Ablaufdatum');
		expect(input.materialization.actions[0].label).toBe('Neu beantragen');
	});

	it('resolves the playbook’s own name (provenance) to German too, not just its fields/events/actions', () => {
		const playbookWithGermanName: NormalizedPlaybook = {
			...NV_PLAYBOOK,
			labelI18n: { de: 'NV-Bescheinigung' }
		};
		const items = fakeItemsPort();
		createItem(
			{ items, playbooks: fakePlaybooksPort([playbookWithGermanName]) },
			{ title: 'NV-Bescheinigung Max', playbookId: 'de.finance.nv-certificate' }
		);
		const input = items.created[0] as { playbook: { name: string } };
		expect(input.playbook.name).toBe('NV-Bescheinigung');
	});

	it('falls back to the English base label when no German translation exists', () => {
		const items = fakeItemsPort();
		createItem(
			{ items, playbooks: fakePlaybooksPort([NV_PLAYBOOK]) },
			{ title: 'NV-Bescheinigung Max', playbookId: 'de.finance.nv-certificate' }
		);
		const input = items.created[0] as { materialization: { actions: { label: string }[] } };
		expect(input.materialization.actions[0].label).toBe('Request new');
	});

	it('trims the title', () => {
		const items = fakeItemsPort();
		createItem({ items, playbooks: fakePlaybooksPort() }, { title: '  Mallorca Trip  ' });
		expect((items.created[0] as { title: string }).title).toBe('Mallorca Trip');
	});
});
