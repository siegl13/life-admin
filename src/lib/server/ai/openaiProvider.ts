/**
 * The only file in the repository allowed to know OpenAI exists at the
 * wire level: the endpoint, the auth header, the Responses API request
 * envelope, the `input_file`/`input_image` parts, the Structured Outputs
 * configuration, response unwrapping, and provider-specific error mapping
 * all live here (see docs/implementation-status.md, Slice 9, for the
 * dated research evidence this was written against). Everything above
 * this file (extraction.ts, filterSuggestions, the use cases, the review
 * UI) is provider-neutral and never imports from here.
 *
 * No `openai` npm package: one HTTP POST via global `fetch`, matching the
 * project's exact-pinned-dependency convention. A shape change here is a
 * contained, one-file fix with a fixture test pinning the current shape.
 */
import {
	ExtractionFailedError,
	ExtractionMalformedOutputError,
	ExtractionTimeoutError,
	ExtractionUnavailableError,
	type DocumentExtractionProviderPort,
	type ExtractionRequest,
	type ExtractionResult
} from '$lib/application/ai/extraction';
import type {
	DocumentRoutingProviderPort,
	RoutingRequest,
	RoutingResult
} from '$lib/application/ai/routing';
import { routingOutputSchema } from '$lib/application/ai/routingOutputSchema';
import { extractionOutputSchema } from '$lib/application/ai/extractionOutputSchema';
import type { AttachmentMimeType } from '$lib/domain/attachment/attachment';
import { log } from '../log';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/** The user's own filename never crosses this boundary — `ExtractionDocument`
 *  has no filename field at all (structural, see extraction.ts). This is
 *  the one place a filename is derived, exclusively from the validated
 *  MIME type, for the one part (`input_file`, PDF) that needs one. */
const NEUTRAL_FILENAME_BY_MIME_TYPE: Record<AttachmentMimeType, string> = {
	'application/pdf': 'document.pdf',
	'image/png': 'document.png',
	'image/jpeg': 'document.jpg',
	'image/webp': 'document.webp'
};

const RESPONSE_JSON_SCHEMA = {
	type: 'object',
	properties: {
		suggestions: {
			type: 'array',
			maxItems: 100,
			items: {
				type: 'object',
				properties: {
					field_key: { type: 'string' },
					value: { type: 'string' }
				},
				required: ['field_key', 'value'],
				additionalProperties: false
			}
		},
		// AI Extraction 1.1. Structured Outputs' strict mode requires every
		// property to be listed in `required` (it has no concept of
		// "optional") — an empty array is how the model says "nothing
		// additional found", not an absent key.
		additional_suggestions: {
			type: 'array',
			maxItems: 30,
			items: {
				type: 'object',
				properties: {
					suggested_label: { type: 'string' },
					suggested_type: { type: 'string', enum: ['text', 'date', 'currency'] },
					value: { type: 'string' }
				},
				required: ['suggested_label', 'suggested_type', 'value'],
				additionalProperties: false
			}
		}
	},
	required: ['suggestions', 'additional_suggestions'],
	additionalProperties: false
} as const;

function buildContentParts(request: ExtractionRequest): unknown[] {
	const promptText = [request.contract, request.userInstruction].filter(Boolean).join('\n\n');
	const base64 = Buffer.from(request.document.bytes).toString('base64');
	const dataUrl = `data:${request.document.mimeType};base64,${base64}`;

	const documentPart =
		request.document.mimeType === 'application/pdf'
			? {
					type: 'input_file',
					filename: NEUTRAL_FILENAME_BY_MIME_TYPE[request.document.mimeType],
					file_data: dataUrl
				}
			: { type: 'input_image', image_url: dataUrl };

	return [{ type: 'input_text', text: promptText }, documentPart];
}

interface OpenAiConfig {
	openaiApiKey: string | null;
	aiModel: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function findByType(items: unknown[], type: string): Record<string, unknown> | undefined {
	return items.find(
		(item): item is Record<string, unknown> => isRecord(item) && item.type === type
	);
}

function isTimeoutError(cause: unknown): boolean {
	return cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
}

/** Thrown when the Responses API itself reports the request did not finish
 *  cleanly (`status: 'incomplete'`/`'failed'`, or a message whose own
 *  `status` disagrees) — distinct from a shape we cannot parse at all, so
 *  the caller can map it to a safe "extraction failed" outcome rather than
 *  risking a partial `output_text` being accepted as a finished answer. */
class ResponseIncompleteError extends Error {}
/** Thrown when the model declined via a `refusal` content part instead of
 *  `output_text` — a real, documented Responses API outcome, not a shape
 *  error. */
class ResponseRefusedError extends Error {}

function extractOutputText(body: unknown): string {
	if (!isRecord(body)) throw new Error('response body is not an object');
	// A response is only trustworthy once OpenAI itself reports it finished:
	// `status` is 'completed' | 'incomplete' | 'failed' at the top level, and
	// an incomplete response can still carry a plausible-looking partial
	// `output_text` that must never be treated as a finished suggestion set.
	if (body.status !== 'completed') {
		throw new ResponseIncompleteError(`response status: ${String(body.status)}`);
	}

	const output = Array.isArray(body.output) ? body.output : undefined;
	const message = output ? findByType(output, 'message') : undefined;
	if (!message) throw new Error('no message in response output');
	// Required, not merely checked-when-present: the official schema
	// defines `status` on every output message, so an absent status is
	// itself untrustworthy, not an "older/simpler shape" to tolerate
	// (review round-02 finding 3).
	if (message.status !== 'completed') {
		throw new ResponseIncompleteError(`message status: ${String(message.status)}`);
	}

	const content = message.content;
	if (!Array.isArray(content)) throw new Error('message has no content');
	// A refusal is a real, documented outcome (the model declined), carried
	// as its own content part type instead of `output_text` — must be
	// detected explicitly rather than falling through to "no output_text".
	if (findByType(content, 'refusal')) throw new ResponseRefusedError('model refused the request');

	const part = findByType(content, 'output_text');
	if (typeof part?.text !== 'string') throw new Error('no output_text in response');
	return part.text;
}

export function createOpenAiProvider(
	config: OpenAiConfig
): DocumentExtractionProviderPort & DocumentRoutingProviderPort {
	return {
		providerId: 'openai',
		modelId: config.aiModel,

		async extract(request: ExtractionRequest): Promise<ExtractionResult> {
			const apiKey = config.openaiApiKey;
			// No key at call time: unavailable, never a network attempt. This
			// is a second, structural guard — extractFromDocument already
			// checked key presence before ever reaching this adapter.
			if (!apiKey) throw new ExtractionUnavailableError('no OpenAI API key configured');

			const warn = (reason: string, status?: number) =>
				log.warn('ai extraction failed', {
					providerId: 'openai',
					modelId: config.aiModel,
					status,
					reason
				});

			const requestBody = {
				model: config.aiModel,
				input: [{ role: 'user', content: buildContentParts(request) }],
				text: {
					format: {
						type: 'json_schema',
						name: 'extraction_result',
						schema: RESPONSE_JSON_SCHEMA,
						strict: true
					}
				},
				max_output_tokens: request.maxOutputTokens,
				// B102/decision log: every production request explicitly opts out
				// of response retention, regardless of the account-level default.
				store: false
			};

			let response: Response;
			try {
				response = await fetch(OPENAI_RESPONSES_URL, {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${apiKey}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(requestBody),
					signal: AbortSignal.timeout(request.timeoutMs)
				});
			} catch (cause) {
				if (isTimeoutError(cause)) {
					warn('timeout');
					throw new ExtractionTimeoutError('extraction timed out');
				}
				warn('network_error');
				throw new ExtractionUnavailableError('network error contacting OpenAI');
			}

			if (response.status === 401 || response.status === 403) {
				warn('unauthorized', response.status);
				throw new ExtractionUnavailableError('OpenAI rejected the API key');
			}
			if (response.status === 429 || response.status >= 500) {
				warn('provider_error', response.status);
				throw new ExtractionFailedError('OpenAI returned an error status');
			}
			if (!response.ok) {
				warn('unexpected_status', response.status);
				throw new ExtractionFailedError('OpenAI returned an unexpected status');
			}

			let body: unknown;
			try {
				body = await response.json();
			} catch (cause) {
				if (isTimeoutError(cause)) {
					warn('timeout');
					throw new ExtractionTimeoutError('extraction timed out');
				}
				if (cause instanceof SyntaxError) {
					warn('invalid_json_body');
					throw new ExtractionMalformedOutputError('response body is not JSON');
				}
				warn('network_error');
				throw new ExtractionUnavailableError('network error reading OpenAI response');
			}

			let outputText: string;
			try {
				outputText = extractOutputText(body);
			} catch (cause) {
				if (cause instanceof ResponseIncompleteError) {
					warn('incomplete_response');
					throw new ExtractionFailedError('OpenAI returned an incomplete response');
				}
				if (cause instanceof ResponseRefusedError) {
					warn('refusal');
					throw new ExtractionFailedError('OpenAI refused the request');
				}
				warn('unexpected_response_shape');
				throw new ExtractionMalformedOutputError('unexpected response shape');
			}

			let parsedOutput: unknown;
			try {
				parsedOutput = JSON.parse(outputText);
			} catch {
				warn('non_json_model_output');
				throw new ExtractionMalformedOutputError('model output is not JSON');
			}

			const parsed = extractionOutputSchema.safeParse(parsedOutput);
			if (!parsed.success) {
				warn('schema_mismatch');
				throw new ExtractionMalformedOutputError('model output failed schema validation');
			}

			return {
				providerId: 'openai',
				modelId: config.aiModel,
				suggestions: parsed.data.suggestions.map((s) => ({
					fieldKey: s.field_key,
					value: s.value
				})),
				additionalSuggestions: (parsed.data.additional_suggestions ?? []).map((s) => ({
					suggestedLabel: s.suggested_label,
					suggestedType: s.suggested_type,
					value: s.value
				}))
			};
		},

		async route(request: RoutingRequest): Promise<RoutingResult> {
			const apiKey = config.openaiApiKey;
			if (!apiKey) throw new ExtractionUnavailableError('no OpenAI API key configured');
			const content = buildContentParts({
				contract:
					'Classify this document. Return only the requested JSON. Do not make changes. Return up to five concise playbook name or purpose hints that describe a likely workflow template.',
				userInstruction: '',
				fields: [],
				document: request.document,
				timeoutMs: request.timeoutMs,
				maxOutputTokens: request.maxOutputTokens
			});
			let response: Response;
			try {
				response = await fetch(OPENAI_RESPONSES_URL, {
					method: 'POST',
					headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
					body: JSON.stringify({
						model: config.aiModel,
						input: [{ role: 'user', content }],
						text: {
							format: {
								type: 'json_schema',
								name: 'routing_result',
								schema: {
									type: 'object',
									properties: {
										document_kind: { type: ['string', 'null'] },
										playbook_matching_hints: {
											type: 'array',
											maxItems: 5,
											items: { type: 'string' }
										},
										item_matching_hints: { type: 'array', maxItems: 5, items: { type: 'string' } }
									},
									required: ['document_kind', 'playbook_matching_hints', 'item_matching_hints'],
									additionalProperties: false
								},
								strict: true
							}
						},
						max_output_tokens: request.maxOutputTokens,
						store: false
					}),
					signal: AbortSignal.timeout(request.timeoutMs)
				});
			} catch (cause) {
				if (isTimeoutError(cause)) throw new ExtractionTimeoutError('routing timed out');
				throw new ExtractionUnavailableError('network error contacting OpenAI');
			}
			if (response.status === 401 || response.status === 403)
				throw new ExtractionUnavailableError('OpenAI rejected the API key');
			if (!response.ok) throw new ExtractionFailedError('OpenAI returned an error status');
			let output: unknown;
			try {
				output = JSON.parse(extractOutputText(await response.json()));
			} catch {
				throw new ExtractionMalformedOutputError('routing output is malformed');
			}
			const parsed = routingOutputSchema.safeParse(output);
			if (!parsed.success)
				throw new ExtractionMalformedOutputError('routing output failed schema validation');
			return {
				providerId: 'openai',
				modelId: config.aiModel,
				documentKind: parsed.data.document_kind,
				playbookMatchingHints: parsed.data.playbook_matching_hints,
				itemMatchingHints: parsed.data.item_matching_hints
			};
		}
	};
}
