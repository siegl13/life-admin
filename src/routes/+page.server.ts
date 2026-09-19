import { fail, redirect } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { setActionState } from '$lib/application/actions/setActionState';
import { getWhatsNext } from '$lib/application/whatsnext/getWhatsNext';
import { ActionNotMutableError } from '$lib/server/db/repositories/actionRepository';
import { actionsPort, clock, whatsNextPort } from '$lib/server/appPorts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const groups = getWhatsNext({ whatsNext: whatsNextPort, clock });
	return { groups };
};

async function transition(request: Request, newState: 'DONE' | 'SKIPPED') {
	const formData = await request.formData();
	const actionId = formData.get('actionId')?.toString();
	const itemId = formData.get('itemId')?.toString();
	if (!actionId || !itemId) return fail(400, { error: 'missing actionId' });

	try {
		setActionState({ actions: actionsPort }, { itemId, actionId, newState });
	} catch (err) {
		if (err instanceof ActionNotMutableError) {
			// One message regardless of cause — see the Slice 8 review,
			// finding 1 (routes/items/[id]/+page.server.ts's transitionAction
			// has the same handling for the item-detail entry point).
			return fail(400, { error: t('items.detail.actionNotMutable') });
		}
		throw err;
	}

	// Redirect back to the clean root URL: without this, the address bar
	// would permanently carry the `?/completeAction`/`?/skipAction`
	// action-query suffix from this POST (no client-side `use:enhance`
	// is used here, so forms keep working with JavaScript disabled).
	redirect(303, '/');
}

export const actions: Actions = {
	completeAction: async ({ request }) => transition(request, 'DONE'),
	skipAction: async ({ request }) => transition(request, 'SKIPPED')
};
