import { z } from 'zod';
import {
	keySchema,
	labelI18nEntrySchema,
	offsetSchema,
	playbookIdSchema,
	playbookVersionSchema
} from './validators';

/**
 * Structural validation for playbook YAML (untrusted input; see
 * docs/adr/0003). This only checks shape and value ranges. Cross-
 * reference checks (does a referenced field/event/action exist? is the
 * dependency graph acyclic?) live in semanticValidation.ts, run after this
 * schema passes.
 *
 * The primitive rules (key format, id/version patterns, label bounds,
 * offset validity) live in validators.ts and are shared verbatim with
 * snapshot.ts's frozen-snapshot schema, so the two can never drift apart
 * (see the Slice 8 review, finding 4).
 */

const labelI18nSchema = labelI18nEntrySchema.optional();

const fieldSchema = z
	.object({
		key: keySchema,
		type: z.enum(['text', 'date', 'currency']),
		label: z.string().min(1).max(200),
		label_i18n: labelI18nSchema,
		recommended: z.boolean().optional().default(false),
		carryForward: z.boolean().optional()
	})
	.strict();

const eventSchema = z
	.object({
		key: keySchema,
		label: z.string().min(1).max(200),
		label_i18n: labelI18nSchema,
		sourceField: z.string().min(1).max(64)
	})
	.strict();

const dueSchema = z
	.object({
		event: z.string().min(1).max(64),
		// Omitting offset entirely means "due exactly at the event date"
		// (a zero offset). An explicit `offset: {}` is still rejected by
		// offsetSchema's refine below — authors must omit the key, not
		// write a meaningless empty object, keeping the two
		// representations unambiguous.
		offset: offsetSchema.optional().default({})
	})
	.strict();

const actionSchema = z
	.object({
		key: keySchema,
		label: z.string().min(1).max(200),
		label_i18n: labelI18nSchema,
		description: z.string().max(2000).optional(),
		due: dueSchema.optional(),
		dependsOn: z.array(z.string().min(1).max(64)).max(10).optional()
	})
	.strict();

export const playbookSchema = z
	.object({
		schemaVersion: z.literal(1),
		id: playbookIdSchema,
		version: playbookVersionSchema,
		name: z.string().min(1).max(200),
		label_i18n: labelI18nSchema,
		description: z.string().max(2000).optional(),
		locale: z.string().min(2).max(10).optional(),
		category: z.string().min(1).max(64).optional(),
		fields: z.array(fieldSchema).max(50).default([]),
		events: z.array(eventSchema).max(50).default([]),
		actions: z.array(actionSchema).max(100).default([])
	})
	.strict();

export type RawPlaybook = z.infer<typeof playbookSchema>;
export type RawField = z.infer<typeof fieldSchema>;
export type RawEvent = z.infer<typeof eventSchema>;
export type RawAction = z.infer<typeof actionSchema>;
export type RawOffset = z.infer<typeof offsetSchema>;

export function parsePlaybookStructure(doc: unknown) {
	return playbookSchema.safeParse(doc);
}
