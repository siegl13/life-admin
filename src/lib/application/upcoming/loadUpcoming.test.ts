import { describe, expect, it, vi } from 'vitest';
import type { WhatsNextRepositoryPort } from '../ports';
import { loadUpcoming } from './loadUpcoming';

describe('loadUpcoming', () => {
	it('loads the existing working set once and uses the Clock date', () => {
		const loadItems = vi.fn(() => [
			{
				itemId: 'item-1',
				title: 'Item',
				actions: [
					{
						actionId: 'action-1',
						label: 'Action',
						state: 'OPEN' as const,
						dueKind: 'MANUAL' as const,
						dueDate: '2026-09-07',
						dueOverrideDate: null,
						position: 0,
						dependencyStates: []
					}
				]
			}
		]);
		const whatsNext: WhatsNextRepositoryPort = { loadItems };

		const result = loadUpcoming({
			whatsNext,
			clock: { todayIso: () => '2026-09-05', nowIso: () => '', localHour: () => 0 }
		});

		expect(loadItems).toHaveBeenCalledOnce();
		expect(result[1].actions[0].actionId).toBe('action-1');
	});
});
