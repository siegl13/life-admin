import { listItems } from '$lib/application/items/listItems';
import { itemsPort } from '$lib/server/appPorts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const archived = url.searchParams.get('archived') === '1';
	const items = listItems({ items: itemsPort }, archived ? 'ARCHIVED' : 'ACTIVE');
	return { items, archived };
};
