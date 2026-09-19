import type { Cycle } from '../../domain/cycle/cycle';
import type { Field } from '../../domain/field/field';
import type { Item } from '../../domain/item/item';
import type { CycleRepositoryPort, FieldRepositoryPort, ItemRepositoryPort } from '../ports';

export interface ItemDetail {
	item: Item;
	cycle: Cycle | null;
	fields: Field[];
}

/**
 * Loads everything an item detail page needs. `cycle`/`fields` are empty
 * only in the theoretical case of an item with no active cycle at all,
 * which never happens for an item created through createItem() — every
 * item gets exactly one ACTIVE cycle at creation.
 */
export function getItemDetail(
	ports: { items: ItemRepositoryPort; cycles: CycleRepositoryPort; fields: FieldRepositoryPort },
	itemId: string
): ItemDetail | null {
	const item = ports.items.getItemById(itemId);
	if (!item) return null;

	const cycle = ports.cycles.getActiveCycle(itemId);
	const fields = cycle ? ports.fields.listFields(cycle.id) : [];

	return { item, cycle, fields };
}
