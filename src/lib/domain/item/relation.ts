export interface ItemRelation {
	itemAId: string;
	itemBId: string;
	createdAt: string;
}

export function canonicalItemPair(itemId: string, relatedItemId: string): [string, string] {
	return itemId < relatedItemId ? [itemId, relatedItemId] : [relatedItemId, itemId];
}
