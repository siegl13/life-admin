import { z } from 'zod';

export const routingOutputSchema = z
	.object({
		document_kind: z.string().max(80).nullable(),
		playbook_matching_hints: z.array(z.string().min(1).max(80)).max(5),
		item_matching_hints: z.array(z.string().min(1).max(80)).max(5)
	})
	.strict();
