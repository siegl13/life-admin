import { searchItems } from '$lib/application/search/searchItems';
import { searchPort } from '$lib/server/appPorts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const page = searchItems({ search: searchPort }, url.searchParams.get('q') ?? '');
	return page;
};
