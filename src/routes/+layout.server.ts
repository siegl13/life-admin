import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	return { language: locals.language, isAuthenticated: locals.user !== null };
};
