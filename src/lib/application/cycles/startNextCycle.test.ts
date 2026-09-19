import { describe, expect, it, vi } from 'vitest';
import type { Cycle } from '../../domain/cycle/cycle';
import type { Item } from '../../domain/item/item';
import { normalizePlaybook } from '../../domain/playbook/normalize';
import { parsePlaybookStructure } from '../../domain/playbook/schema';
import type {
	ActionRepositoryPort,
	CycleRepositoryPort,
	FieldRepositoryPort,
	ItemRepositoryPort,
	StartNextCycleInput
} from '../ports';
import { ItemHasNoActiveCycleError } from '../items/updateItemFields';
import {
	CycleNotCompleteError,
	InvalidPlaybookSnapshotError,
	ItemHasNoPlaybookError,
	ItemIsArchivedError,
	startNextCycle
} from './startNextCycle';

// docs/adr (Slice 8, cycles and rollover); docs/adr/0004 amendment.
function rawPlaybook(overrides: Record<string, unknown> = {}) {
	const result = parsePlaybookStructure({
		schemaVersion: 1,
		id: 'de.finance.nv-certificate',
		version: '2.0.0',
		name: 'NV certificate',
		label_i18n: { de: 'NV-Bescheinigung' },
		fields: [
			{ key: 'valid_until', type: 'date', label: 'Valid until', label_i18n: { de: 'Gültig bis' } }
		],
		events: [{ key: 'expiry', label: 'Expiry', sourceField: 'valid_until' }],
		actions: [
			{
				key: 'request_new',
				label: 'Request new',
				label_i18n: { de: 'Neu beantragen' },
				due: { event: 'expiry', offset: { months: -2 } }
			}
		],
		...overrides
	});
	if (!result.success) throw new Error('fixture failed structural validation');
	return normalizePlaybook(result.data);
}

function fakeItem(overrides: Partial<Item> = {}): Item {
	return {
		id: 'item-1',
		title: 'Test item',
		note: null,
		status: 'ACTIVE',
		playbookId: 'de.finance.nv-certificate',
		playbookVersion: '1.0.0',
		playbookName: 'NV certificate',
		playbookSnapshot: rawPlaybook(),
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		archivedAt: null,
		...overrides
	};
}

function fakeCycle(overrides: Partial<Cycle> = {}): Cycle {
	return {
		id: 'cycle-1',
		itemId: 'item-1',
		sequence: 1,
		status: 'ACTIVE',
		createdAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

function ports(opts: {
	item?: Item | null;
	cycle?: Cycle | null;
	actionStates?: ('OPEN' | 'DONE' | 'SKIPPED')[];
	previousFields?: { fieldKey: string; type: 'text' | 'date'; value: string | null }[];
}) {
	const startNextCycleMock = vi.fn((_input: StartNextCycleInput) =>
		fakeCycle({ id: 'cycle-2', sequence: 2 })
	);
	const items: ItemRepositoryPort = {
		createItem: vi.fn(),
		getItemById: vi.fn(() => opts.item ?? fakeItem()),
		listItems: vi.fn(() => []),
		setItemStatus: vi.fn()
	};
	const cycles: CycleRepositoryPort = {
		getActiveCycle: vi.fn(() => (opts.cycle === undefined ? fakeCycle() : opts.cycle)),
		listCycles: vi.fn(() => []),
		startNextCycle: startNextCycleMock
	};
	const fields: FieldRepositoryPort = {
		listFields: vi.fn(
			() =>
				(opts.previousFields ?? []).map((f, i) => ({
					id: `f-${i}`,
					cycleId: 'cycle-1',
					fieldKey: f.fieldKey,
					label: f.fieldKey,
					type: f.type,
					origin: 'PLAYBOOK' as const,
					recommended: false,
					position: i,
					value: f.value
				})) as never
		),
		addCustomField: vi.fn(),
		removeCustomField: vi.fn()
	};
	const actions: ActionRepositoryPort = {
		listActions: vi.fn(
			() => (opts.actionStates ?? ['DONE']).map((state, i) => ({ id: `a-${i}`, state })) as never
		),
		listDependencies: vi.fn(() => []),
		setActionState: vi.fn(),
		addManualAction: vi.fn(),
		setActionDueOverride: vi.fn()
	};
	return { items, cycles, fields, actions, startNextCycleMock };
}

describe('startNextCycle (Slice 8)', () => {
	it('refuses while any action of the active cycle is OPEN', () => {
		const p = ports({ actionStates: ['OPEN', 'DONE'] });
		expect(() => startNextCycle(p, { itemId: 'item-1' })).toThrow(CycleNotCompleteError);
		expect(p.startNextCycleMock).not.toHaveBeenCalled();
	});

	it('refuses on an ARCHIVED item', () => {
		const p = ports({ item: fakeItem({ status: 'ARCHIVED' }) });
		expect(() => startNextCycle(p, { itemId: 'item-1' })).toThrow(ItemIsArchivedError);
		expect(p.startNextCycleMock).not.toHaveBeenCalled();
	});

	it('refuses without an active cycle', () => {
		const p = ports({ cycle: null });
		expect(() => startNextCycle(p, { itemId: 'item-1' })).toThrow(ItemHasNoActiveCycleError);
	});

	it('refuses a generic item with no playbook snapshot', () => {
		const p = ports({ item: fakeItem({ playbookSnapshot: null }) });
		expect(() => startNextCycle(p, { itemId: 'item-1' })).toThrow(ItemHasNoPlaybookError);
		expect(p.startNextCycleMock).not.toHaveBeenCalled();
	});

	it('a corrupt snapshot throws InvalidPlaybookSnapshotError and calls no write port', () => {
		const p = ports({ item: fakeItem({ playbookSnapshot: { garbage: true } }) });
		expect(() => startNextCycle(p, { itemId: 'item-1' })).toThrow(InvalidPlaybookSnapshotError);
		expect(p.startNextCycleMock).not.toHaveBeenCalled();
	});

	it('refuses when the stored JSON itself failed to parse, distinctly from "no playbook" (Slice 8 review, finding 3)', () => {
		const p = ports({
			item: fakeItem({ playbookSnapshot: null, playbookSnapshotCorrupted: true })
		});
		expect(() => startNextCycle(p, { itemId: 'item-1' })).toThrow(InvalidPlaybookSnapshotError);
		expect(p.startNextCycleMock).not.toHaveBeenCalled();
	});

	it('never reads the playbook catalog: the dependency object structurally has no playbooks port', () => {
		const p = ports({});
		startNextCycle(p, { itemId: 'item-1' });
		// If startNextCycle's signature ever grew a `playbooks` dependency,
		// this object would need one too — its absence here is exactly what
		// makes "never reads the current YAML" a compile-time fact.
		expect(Object.keys(p)).toEqual(
			expect.arrayContaining(['items', 'cycles', 'fields', 'actions'])
		);
		expect(Object.keys(p)).not.toContain('playbooks');
	});

	it('passes the frozen snapshot version, not any current playbook version', () => {
		const p = ports({});
		startNextCycle(p, { itemId: 'item-1' });
		expect(p.startNextCycleMock).toHaveBeenCalledWith(
			expect.objectContaining({ playbookVersion: '2.0.0' })
		);
	});

	it('passes the completing cycle id explicitly', () => {
		const p = ports({ cycle: fakeCycle({ id: 'cycle-active-id' }) });
		startNextCycle(p, { itemId: 'item-1' });
		expect(p.startNextCycleMock).toHaveBeenCalledWith(
			expect.objectContaining({ completingCycleId: 'cycle-active-id' })
		);
	});

	it('resolves labels to the current locale exactly like createItem does', () => {
		const p = ports({});
		startNextCycle(p, { itemId: 'item-1' });
		const call = p.startNextCycleMock.mock.calls[0][0];
		expect(call.fields[0].label).toBe('Gültig bis');
		expect(call.actions[0].label).toBe('Neu beantragen');
	});

	it('carries a text-carrying field value from the previous cycle into the seed', () => {
		const p = ports({
			previousFields: [{ fieldKey: 'valid_until', type: 'date', value: '2026-06-01' }]
		});
		startNextCycle(p, { itemId: 'item-1' });
		const call = p.startNextCycleMock.mock.calls[0][0];
		// valid_until is a date field with no explicit carryForward, so it
		// resets rather than carrying — proves the real rollover rule ran,
		// not a stub.
		expect(call.fields[0].value).toBeNull();
	});
});
