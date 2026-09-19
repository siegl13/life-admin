import { describe, expect, it, vi } from 'vitest';
import type { Action } from '$lib/domain/action/action';
import type { Field } from '$lib/domain/field/field';
import { loadItemOverview } from './loadItemOverview';

describe('loadItemOverview', () => {
	it('selects at most three non-empty playbook fields in repository order', () => {
		const nextAction: Action = {
			id: 'next-action',
			cycleId: 'cycle',
			actionKey: 'next',
			label: 'Next action',
			description: null,
			state: 'OPEN',
			position: 0,
			createdAt: 'now',
			completedAt: null,
			dueKind: 'NONE',
			dueDate: null,
			dueOverrideDate: null
		};
		const fields = [
			field('first', '1', 'PLAYBOOK'),
			field('empty', null, 'PLAYBOOK'),
			field('custom', 'custom', 'CUSTOM'),
			field('second', '2', 'PLAYBOOK'),
			field('third', '3', 'PLAYBOOK'),
			field('fourth', '4', 'PLAYBOOK')
		];
		const overview = loadItemOverview(
			{
				cycles: {
					getActiveCycle: vi.fn(() => ({
						id: 'cycle',
						itemId: 'item',
						sequence: 1,
						status: 'ACTIVE' as const,
						createdAt: 'now'
					})),
					listCycles: vi.fn(),
					startNextCycle: vi.fn()
				},
				actions: {
					listActions: vi.fn(() => [nextAction]),
					listDependencies: vi.fn(() => []),
					setActionState: vi.fn(),
					addManualAction: vi.fn(),
					setActionDueOverride: vi.fn()
				},
				events: { listEvents: vi.fn(() => []) },
				fields: {
					listFields: vi.fn(() => fields),
					addCustomField: vi.fn(),
					removeCustomField: vi.fn()
				},
				attachments: {
					listByItem: vi.fn(),
					listByCycle: vi.fn(),
					getById: vi.fn(),
					countByItem: vi.fn(() => 2),
					insert: vi.fn(),
					rename: vi.fn(),
					deleteById: vi.fn(),
					listStorageKeysForItem: vi.fn()
				},
				relations: {
					link: vi.fn(),
					unlink: vi.fn(),
					listRelated: vi.fn(),
					listCandidates: vi.fn(),
					countRelated: vi.fn(() => 4),
					deleteForItem: vi.fn(),
					get: vi.fn()
				}
			},
			'item'
		);
		expect(overview.importantFields.map((entry) => entry.fieldKey)).toEqual([
			'first',
			'second',
			'third'
		]);
		expect(overview.documentCount).toBe(2);
		expect(overview.relationCount).toBe(4);
		expect(overview.nextAction?.action).toBe(nextAction);
	});

	it('returns an empty projection when the item has no active cycle', () => {
		const overview = loadItemOverview(
			{
				cycles: {
					getActiveCycle: vi.fn(() => null),
					listCycles: vi.fn(),
					startNextCycle: vi.fn()
				},
				actions: {
					listActions: vi.fn(() => []),
					listDependencies: vi.fn(() => []),
					setActionState: vi.fn(),
					addManualAction: vi.fn(),
					setActionDueOverride: vi.fn()
				},
				events: { listEvents: vi.fn(() => []) },
				fields: {
					listFields: vi.fn(() => []),
					addCustomField: vi.fn(),
					removeCustomField: vi.fn()
				},
				attachments: {
					listByItem: vi.fn(),
					listByCycle: vi.fn(),
					getById: vi.fn(),
					countByItem: vi.fn(() => 0),
					insert: vi.fn(),
					rename: vi.fn(),
					deleteById: vi.fn(),
					listStorageKeysForItem: vi.fn()
				},
				relations: {
					link: vi.fn(),
					unlink: vi.fn(),
					listRelated: vi.fn(),
					listCandidates: vi.fn(),
					countRelated: vi.fn(() => 0),
					deleteForItem: vi.fn(),
					get: vi.fn()
				}
			},
			'item'
		);

		expect(overview).toEqual({
			nextAction: null,
			importantFields: [],
			documentCount: 0,
			relationCount: 0
		});
	});
});

function field(fieldKey: string, value: string | null, origin: 'PLAYBOOK' | 'CUSTOM'): Field {
	return {
		id: fieldKey,
		cycleId: 'cycle',
		fieldKey,
		label: fieldKey,
		type: 'text',
		origin,
		recommended: false,
		position: 0,
		value
	};
}
