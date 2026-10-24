import { z } from 'zod';

/**
 * The strict shape a provider's raw JSON output must match. `.strict()`
 * on both levels means a model that volunteers an extra key — most
 * concretely `confidence` — is rejected as a hard schema failure
 * (ExtractionMalformedOutputError) rather than silently ignored. This is
 * the trust boundary for *shape*; filterSuggestions is the trust boundary
 * for *content* (unknown field keys, invalid dates, duplicates, ...).
 */
export const extractionOutputSchema = z
	.object({
		suggestions: z
			.array(
				z
					.object({
						field_key: z.string().min(1).max(64),
						value: z.string().max(2000)
					})
					.strict()
			)
			.max(100),
		/** AI Extraction 1.1: administrative facts found in the document that
		 *  aren't one of the known fields. Optional at the shape level (a
		 *  fixture, or a model turn that finds nothing extra, may omit it
		 *  entirely) — content trust (label length, supported type, value
		 *  shape, duplicate/count limits) is `filterAdditionalSuggestions`'s
		 *  job, same split as `suggestions`/`filterSuggestions`. */
		additional_suggestions: z
			.array(
				z
					.object({
						suggested_label: z.string().min(1).max(200),
						suggested_type: z.enum(['text', 'date', 'currency']),
						value: z.string().max(2000)
					})
					.strict()
			)
			.max(30)
			.optional(),
		/** Document Action Suggestions. Shape only; content trust (empty
		 *  titles, unknown anchors, invalid dates, duplicates, ALREADY_DONE)
		 *  is `filterActionSuggestions`'s job. */
		action_suggestions: z
			.array(
				z
					.object({
						title: z.string().min(1).max(200),
						context: z.string().max(1000).nullish(),
						evidence: z.string().max(1000).nullish(),
						status: z.enum(['OPEN', 'ALREADY_DONE']).nullish(),
						date: z
							.object({
								kind: z.enum(['DUE_BY', 'AVAILABLE_FROM', 'ON_DATE', 'APPROXIMATE', 'NONE']),
								value: z.string().max(40).nullish(),
								relative: z
									.object({
										relation: z.enum(['BEFORE', 'AFTER']),
										amount: z.number().int().min(1).max(3650),
										unit: z.enum(['DAYS', 'WEEKS', 'MONTHS', 'YEARS']),
										anchor_field_key: z.string().min(1).max(64).nullish(),
										anchor_date: z.string().max(40).nullish(),
										anchor_label: z.string().max(120).nullish()
									})
									.strict()
									.nullish()
							})
							.strict()
					})
					.strict()
			)
			.max(20)
			.optional()
	})
	.strict();

export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;
