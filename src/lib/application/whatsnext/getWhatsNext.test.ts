import { describe, expect, it, vi } from 'vitest';
import type { WhatsNextItemInput } from '$lib/domain/whatsnext/whatsNext';
import { getWhatsNext } from './getWhatsNext';

describe('getWhatsNext', () => {
	it('keeps due-edit eligibility metadata in the application view without changing domain output', () => {
		const items: WhatsNextItemInput[] = [
			{
				itemId: 'item-1',
				title: 'Vehicle inspection',
				actions: [
					{
						actionId: 'derived',
						label: 'Book inspection',
						state: 'OPEN',
						dueKind: 'DERIVED',
						dueDate: '2026-12-01',
						dueOverrideDate: '2026-11-15',
						position: 0,
						dependencyStates: []
					},
					{
						actionId: 'manual',
						label: 'Call the garage',
						state: 'OPEN',
						dueKind: 'MANUAL',
						dueDate: null,
						dueOverrideDate: null,
						position: 1,
						dependencyStates: []
					}
				]
			}
		];
		const loadItems = vi.fn(() => items);

		const result = getWhatsNext({
			whatsNext: { loadItems },
			clock: { todayIso: () => '2026-10-08', nowIso: () => '', localHour: () => 12 }
		});

		expect(loadItems).toHaveBeenCalledOnce();
		expect(result[0].actions).toEqual([
			{
				actionId: 'manual',
				label: 'Call the garage',
				dueDate: null,
				bucket: 1,
				dueEditability: {
					state: 'OPEN',
					dueKind: 'MANUAL',
					suggestedDueDate: null,
					dueOverrideDate: null
				}
			},
			{
				actionId: 'derived',
				label: 'Book inspection',
				dueDate: '2026-11-15',
				bucket: 2,
				dueEditability: {
					state: 'OPEN',
					dueKind: 'DERIVED',
					suggestedDueDate: '2026-12-01',
					dueOverrideDate: '2026-11-15'
				}
			}
		]);
	});
});
