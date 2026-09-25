import { loadUpcoming } from '$lib/application/upcoming/loadUpcoming';
import { clock, whatsNextPort } from '$lib/server/appPorts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	ranges: loadUpcoming({ whatsNext: whatsNextPort, clock })
});
