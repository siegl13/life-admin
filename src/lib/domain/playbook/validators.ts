import { z } from 'zod';

/**
 * Zod primitives shared between the raw-YAML schema (schema.ts) and the
 * frozen-snapshot schema (snapshot.ts). Both describe "a valid normalized
 * playbook", just at different points in the pipeline (author-facing YAML
 * vs. a value already read back out of the database) — see the Slice 8
 * review, finding 4: keeping one definition of each rule here is what
 * stops the two schemas from silently drifting apart.
 */

export const RESERVED_KEY_PREFIXES = ['m_', 'c_'];

const KEY_PATTERN = /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/;

export const keySchema = z
	.string()
	.min(1)
	.max(64)
	.regex(KEY_PATTERN, 'must be lowercase alphanumeric with - or _, no leading/trailing separator')
	.refine((key) => !RESERVED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)), {
		message: `must not start with a reserved prefix (${RESERVED_KEY_PREFIXES.join(', ')})`
	});

const PLAYBOOK_ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9][a-z0-9-]*)+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export const playbookIdSchema = z
	.string()
	.regex(PLAYBOOK_ID_PATTERN, 'must look like de.category.name');

export const playbookVersionSchema = z
	.string()
	.regex(SEMVER_PATTERN, 'must be a strict semver x.y.z');

/** Bounded record of locale code -> label text, shared by every
 *  label_i18n/labelI18n field at every level of the playbook. */
export const labelI18nEntrySchema = z.record(z.string().min(2).max(10), z.string().min(1).max(200));

const OFFSET_MIN = -600;
const OFFSET_MAX = 600;

/** Bounded offset shape, with no opinion on whether `{}` (zero offset) is
 *  acceptable — that differs between the two callers. Raw YAML authoring
 *  (schema.ts) forces the author to omit `offset` entirely for a zero
 *  offset rather than write a meaningless `{}`; a normalized/frozen
 *  snapshot (snapshot.ts) has already resolved "no offset" to exactly
 *  `{}` (see normalize.ts's `due.offset` and dueSchema's `.default({})`),
 *  so `{}` there is the legitimate value, not redundant author input. */
export const offsetShape = z
	.object({
		years: z.number().int().min(OFFSET_MIN).max(OFFSET_MAX).optional(),
		months: z.number().int().min(OFFSET_MIN).max(OFFSET_MAX).optional(),
		weeks: z.number().int().min(OFFSET_MIN).max(OFFSET_MAX).optional(),
		days: z.number().int().min(OFFSET_MIN).max(OFFSET_MAX).optional()
	})
	.strict();

/** The raw-YAML-authoring variant: rejects an explicit, redundant `{}` —
 *  see offsetShape's doc comment. */
export const offsetSchema = offsetShape.refine((o) => o.years || o.months || o.weeks || o.days, {
	message: 'offset must specify at least one non-zero component'
});
