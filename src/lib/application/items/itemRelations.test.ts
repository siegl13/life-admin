import { describe, expect, it, vi } from 'vitest';
import type { Clock, ItemRelationRepositoryPort } from '../ports';
import { InvalidItemRelationError, linkItems, searchRelationCandidates } from './itemRelations';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const clock: Clock = {
	nowIso: () => '2026-01-01T00:00:00.000Z',
	todayIso: () => '2026-01-01',
	localHour: () => 12
};

function relations(
	overrides: Partial<ItemRelationRepositoryPort> = {}
): ItemRelationRepositoryPort {
	return {
		link: vi.fn(() => 'LINKED' as const),
		unlink: vi.fn(() => 'UNLINKED' as const),
		listRelated: vi.fn(() => []),
		listCandidates: vi.fn(() => []),
		countRelated: vi.fn(() => 0),
		deleteForItem: vi.fn(() => 0),
		get: vi.fn(() => null),
		...overrides
	};
}

describe('item relation use cases', () => {
	it('rejects malformed ids and self links before persistence', () => {
		const port = relations();
		expect(() =>
			linkItems({ relations: port, clock }, { itemId: 'bad', relatedItemId: B })
		).toThrowError(new InvalidItemRelationError('MALFORMED_ID'));
		expect(() =>
			linkItems({ relations: port, clock }, { itemId: A, relatedItemId: A })
		).toThrowError(new InvalidItemRelationError('SELF_LINK'));
		expect(port.link).not.toHaveBeenCalled();
	});

	it('rejects duplicate and archived relations instead of treating them as idempotent', () => {
		for (const [result, reason] of [
			['DUPLICATE', 'DUPLICATE'],
			['ARCHIVED_ITEM', 'ARCHIVED_ITEM']
		] as const) {
			expect(() =>
				linkItems(
					{
						relations: relations({ link: vi.fn(() => result) }),
						clock
					},
					{ itemId: A, relatedItemId: B }
				)
			).toThrowError(new InvalidItemRelationError(reason));
		}
	});

	it('uses five recent candidates without a query and caps search at twenty', () => {
		const listCandidates = vi.fn(() => []);
		const port = relations({ listCandidates });
		searchRelationCandidates({ relations: port }, A, '');
		expect(listCandidates).toHaveBeenLastCalledWith(A, '', 5);
		searchRelationCandidates({ relations: port }, A, '  TITLE  ');
		expect(listCandidates).toHaveBeenLastCalledWith(A, 'title', 20);
	});
});
