import { describe, expect, it, vi } from 'vitest';
import type { Item } from '../../domain/item/item';
import type { ItemRepositoryPort } from '../ports';
import { ItemNotFoundError, setItemArchived } from './setItemArchived';

function fakeItem(overrides: Partial<Item> = {}): Item {
	return {
		id: 'item-1',
		title: 'Test item',
		note: null,
		status: 'ACTIVE',
		playbookId: null,
		playbookVersion: null,
		playbookName: null,
		playbookSnapshot: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		archivedAt: null,
		...overrides
	};
}

describe('setItemArchived', () => {
	it('archives an item, setting status to ARCHIVED', () => {
		const setItemStatus = vi.fn((id, status) => fakeItem({ id, status }));
		const items: ItemRepositoryPort = {
			createItem: vi.fn(),
			getItemById: vi.fn(() => fakeItem()),
			listItems: vi.fn(() => []),
			setItemStatus
		};

		setItemArchived({ items }, { itemId: 'item-1', archived: true });

		expect(setItemStatus).toHaveBeenCalledWith('item-1', 'ARCHIVED');
	});

	it('unarchives an item, setting status back to ACTIVE, without touching any cycle port', () => {
		const setItemStatus = vi.fn((id, status) => fakeItem({ id, status }));
		const items: ItemRepositoryPort = {
			createItem: vi.fn(),
			getItemById: vi.fn(() => fakeItem({ status: 'ARCHIVED' })),
			listItems: vi.fn(() => []),
			setItemStatus
		};

		setItemArchived({ items }, { itemId: 'item-1', archived: false });

		expect(setItemStatus).toHaveBeenCalledWith('item-1', 'ACTIVE');
	});

	it('throws when the item does not exist, and calls no write port', () => {
		const setItemStatus = vi.fn();
		const items: ItemRepositoryPort = {
			createItem: vi.fn(),
			getItemById: vi.fn(() => null),
			listItems: vi.fn(() => []),
			setItemStatus
		};

		expect(() => setItemArchived({ items }, { itemId: 'missing', archived: true })).toThrow(
			ItemNotFoundError
		);
		expect(setItemStatus).not.toHaveBeenCalled();
	});
});
