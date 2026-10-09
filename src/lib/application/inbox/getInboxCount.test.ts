import { describe, expect, it, vi } from 'vitest';
import type { InboxRepositoryPort } from '../ports';
import { getInboxCount } from './getInboxCount';

describe('getInboxCount', () => {
	it('returns the number of pending documents from the repository port', () => {
		const listPending = vi.fn<InboxRepositoryPort['listPending']>(() => [
			{} as ReturnType<InboxRepositoryPort['listPending']>[number],
			{} as ReturnType<InboxRepositoryPort['listPending']>[number]
		]);

		expect(getInboxCount({ inbox: { listPending } as unknown as InboxRepositoryPort })).toBe(2);
		expect(listPending).toHaveBeenCalledOnce();
	});
});
