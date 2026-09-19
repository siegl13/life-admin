import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
	createItem,
	TitleRequiredError,
	UnknownPlaybookError
} from '$lib/application/items/createItem';
import { listPlaybooks } from '$lib/application/playbooks/listPlaybooks';
import { itemsPort, playbooksPort } from '$lib/server/appPorts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const playbooks = listPlaybooks({ playbooks: playbooksPort });
	return { playbooks };
};

const formSchema = z.object({
	title: z.string(),
	playbookId: z.string().optional()
});

export const actions: Actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const parsed = formSchema.safeParse({
			title: formData.get('title')?.toString() ?? '',
			playbookId: formData.get('playbookId')?.toString() || undefined
		});

		if (!parsed.success) {
			return fail(400, { error: 'invalid-form' as const, title: '' });
		}

		let item;
		try {
			item = createItem(
				{ items: itemsPort, playbooks: playbooksPort },
				{ title: parsed.data.title, playbookId: parsed.data.playbookId || null }
			);
		} catch (err) {
			if (err instanceof TitleRequiredError) {
				return fail(400, { error: 'title-required' as const, title: parsed.data.title });
			}
			if (err instanceof UnknownPlaybookError) {
				return fail(400, { error: 'unknown-playbook' as const, title: parsed.data.title });
			}
			throw err;
		}

		redirect(303, `/items/${item.id}`);
	}
};
