import type { Item } from '../../domain/item/item';
import type { ItemStatus } from '../../domain/item/item';
import type { ItemRepositoryPort } from '../ports';

export function listItems(ports: { items: ItemRepositoryPort }, status?: ItemStatus): Item[] {
	return ports.items.listItems(status);
}
