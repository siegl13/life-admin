import { z } from 'zod';
import type { NormalizedPlaybook } from './normalize';
import { validatePlaybookSemantics } from './semanticValidation';
import {
	keySchema,
	labelI18nEntrySchema,
	offsetShape,
	playbookIdSchema,
	playbookVersionSchema
} from './validators';

/**
 * Zod schema for the NORMALIZED playbook shape as stored in
 * items.playbook_snapshot. The snapshot was written by our own
 * normalizePlaybook(), but it is read back out of the database, and a
 * database can be hand-edited or restored from a tampered archive. By the
 * same logic as docs/adr/0003, it is untrusted input at read time.
 *
 * Every rule here (key format, id/version patterns, label bounds, offset
 * validity) is the exact same Zod primitive the raw-YAML schema.ts uses —
 * see validators.ts — so a value the normal playbook pipeline would never
 * produce cannot become "valid" merely because it arrived as a stored
 * snapshot instead (Slice 8 review, finding 4).
 *
 * `carryForward` is optional on purpose: a snapshot written before this
 * property existed has no `carryForward` anywhere, and it must still
 * validate (see docs/adr/0004's Slice 8 amendment and the Slice 8 ADR) —
 * every field simply takes the type-driven fallback, exactly the
 * behavior that item already had.
 */
const labelI18nSchema = labelI18nEntrySchema;

const normalizedFieldSchema = z
	.object({
		key: keySchema,
		type: z.enum(['text', 'date', 'currency']),
		label: z.string().min(1).max(200),
		labelI18n: labelI18nSchema,
		recommended: z.boolean(),
		position: z.number().int().min(0),
		carryForward: z.boolean().optional()
	})
	.strict();

const normalizedEventSchema = z
	.object({
		key: keySchema,
		label: z.string().min(1).max(200),
		labelI18n: labelI18nSchema,
		sourceField: z.string().min(1).max(64),
		position: z.number().int().min(0)
	})
	.strict();

const normalizedActionSchema = z
	.object({
		key: keySchema,
		label: z.string().min(1).max(200),
		labelI18n: labelI18nSchema,
		description: z.string().max(2000).nullable(),
		due: z.object({ event: z.string().min(1).max(64), offset: offsetShape }).nullable(),
		dependsOn: z.array(z.string().min(1).max(64)).max(10),
		position: z.number().int().min(0)
	})
	.strict();

export const normalizedPlaybookSchema: z.ZodType<NormalizedPlaybook> = z
	.object({
		schemaVersion: z.literal(1),
		id: playbookIdSchema,
		version: playbookVersionSchema,
		name: z.string().min(1).max(200),
		labelI18n: labelI18nSchema,
		description: z.string().max(2000).nullable(),
		locale: z.string().min(2).max(10).nullable(),
		category: z.string().min(1).max(64).nullable(),
		fields: z.array(normalizedFieldSchema).max(50),
		events: z.array(normalizedEventSchema).max(50),
		actions: z.array(normalizedActionSchema).max(100)
	})
	.strict();

/** One rejected location in a snapshot, bounded so it is always safe to
 *  log: no message text (which for some Zod checks — e.g. an enum
 *  mismatch — embeds the actual rejected value) and no unbounded path
 *  (a z.record() key is itself snapshot-controlled data). See the Slice 8
 *  review, finding 5. */
export interface SnapshotValidationIssue {
	path: (string | number)[];
}

const MAX_LOGGED_PATH_SEGMENTS = 20;
const MAX_LOGGED_SEGMENT_LENGTH = 40;

function boundedPath(path: readonly PropertyKey[]): (string | number)[] {
	return path.slice(0, MAX_LOGGED_PATH_SEGMENTS).map((segment) => {
		// Zod's ZodIssue.path is typed PropertyKey[], but a symbol segment
		// never actually occurs for the object/array/record shapes this
		// schema validates — normalized defensively rather than asserted away.
		if (typeof segment === 'symbol') return '(symbol)';
		return typeof segment === 'string' && segment.length > MAX_LOGGED_SEGMENT_LENGTH
			? segment.slice(0, MAX_LOGGED_SEGMENT_LENGTH) + '…'
			: segment;
	});
}

export function parsePlaybookSnapshot(
	value: unknown
): { ok: true; playbook: NormalizedPlaybook } | { ok: false; issues: SnapshotValidationIssue[] } {
	const structural = normalizedPlaybookSchema.safeParse(value);
	if (!structural.success) {
		return {
			ok: false,
			issues: structural.error.issues.map((issue) => ({ path: boundedPath(issue.path) }))
		};
	}
	const semantic = validatePlaybookSemantics(structural.data);
	if (semantic.length > 0) {
		// issue.path is our own code's string (e.g. `fields[key=xxx]`), built
		// only from keys that already passed keySchema above — bounded and
		// safe already, but still capped for defense in depth.
		return { ok: false, issues: semantic.map((issue) => ({ path: boundedPath([issue.path]) })) };
	}
	return { ok: true, playbook: structural.data };
}
