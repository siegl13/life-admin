import type { Item } from '../../domain/item/item';
import type { ItemRepositoryPort } from '../ports';

export class ItemNotFoundError extends Error {}

/**
 * Archives or unarchives an item. Does not touch the active cycle:
 * archiving is a visibility switch, not a state change on the item's
 * work. Every read path (the items list, What's Next) already filters on
 * item status, so no cycle-level write is needed to make an archived
 * item disappear, and unarchiving is an exact inverse rather than a
 * resurrection (see the cycles/archive ADR).
 */
export function setItemArchived(
	ports: { items: ItemRepositoryPort },
	input: { itemId: string; archived: boolean }
): Item {
	if (!ports.items.getItemById(input.itemId)) throw new ItemNotFoundError();
	return ports.items.setItemStatus(input.itemId, input.archived ? 'ARCHIVED' : 'ACTIVE');
}
