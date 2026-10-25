import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiProvider } from './openaiProvider';
import { log } from '../log';
import {
	ExtractionFailedError,
	ExtractionMalformedOutputError,
	ExtractionRateLimitError,
	ExtractionTimeoutError,
	ExtractionUnavailableError,
	type ExtractionRequest
} from '$lib/application/ai/extraction';
import type { RoutingRequest } from '$lib/application/ai/routing';

function baseRequest(overrides: Partial<ExtractionRequest> = {}): ExtractionRequest {
	return {
		contract: 'CONTRACT TEXT',
		userInstruction: 'INSTRUCTION TEXT',
		fields: [{ fieldKey: 'contract_end', label: 'Contract end', type: 'date' }],
		document: { mimeType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) },
		timeoutMs: 60_000,
		maxOutputTokens: 2000,
		...overrides
	};
}

function routingRequest(): RoutingRequest {
	return {
		document: { mimeType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) },
		timeoutMs: 60_000,
		maxOutputTokens: 200
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

function responsesApiEnvelope(outputText: string) {
	return {
		status: 'completed',
		output: [
			{
				type: 'message',
				status: 'completed',
				content: [{ type: 'output_text', text: outputText }]
			}
		]
	};
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('createOpenAiProvider', () => {
	it('returns only count and token diagnostics alongside validated output', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				...responsesApiEnvelope(
					JSON.stringify({
						suggestions: [],
						action_suggestions: [
							{
								title: 'Identitätsprüfung durchführen',
								context: null,
								evidence: 'synthetic-source',
								status: 'OPEN',
								date: { kind: 'NONE', value: null, relative: null }
							}
						]
					})
				),
				usage: { input_tokens: 12000, output_tokens: 350, unexpected: 'private' }
			})
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'test-model' });
		const result = await provider.extract(baseRequest());
		expect(result.diagnostics).toEqual({
			completionStatus: 'completed',
			providerActionCount: 1,
			schemaValidActionCount: 1,
			inputTokens: 12000,
			outputTokens: 350
		});
		expect(result.actionSuggestions).toHaveLength(1);
	});

	it('does not coerce missing or untrusted token usage into diagnostic values', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				...responsesApiEnvelope('{"suggestions":[],"action_suggestions":[]}'),
				usage: { input_tokens: 'secret', output_tokens: -1 }
			})
		);
		const result = await createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'test-model' }).extract(
			baseRequest()
		);
		expect(result.diagnostics).toMatchObject({ inputTokens: null, outputTokens: null });
	});

	it('logs raw action count on schema failure, without output contents or request data', async () => {
		const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
		fetchMock.mockResolvedValue(
			jsonResponse({
				...responsesApiEnvelope(
					JSON.stringify({ suggestions: [], action_suggestions: [{ title: 'private-source' }] })
				),
				usage: { input_tokens: 100, output_tokens: 20 }
			})
		);
		await expect(
			createOpenAiProvider({ openaiApiKey: 'private-key', aiModel: 'test-model' }).extract(
				baseRequest()
			)
		).rejects.toThrow(ExtractionMalformedOutputError);
		expect(warn).toHaveBeenCalledWith('ai extraction failed', {
			providerId: 'openai',
			modelId: 'test-model',
			status: undefined,
			reason: 'schema_mismatch',
			completionStatus: 'completed',
			inputTokens: 100,
			outputTokens: 20,
			providerActionCount: 1,
			maxOutputTokens: 2000
		});
		for (const privateValue of [
			'private-source',
			'private-key',
			'CONTRACT TEXT',
			'INSTRUCTION TEXT'
		]) {
			expect(JSON.stringify(warn.mock.calls)).not.toContain(privateValue);
		}
	});

	it('throws ExtractionUnavailableError with no API key configured, and never calls fetch', async () => {
		const provider = createOpenAiProvider({ openaiApiKey: null, aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionUnavailableError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('sends the API key in the Authorization header and nowhere else in the request body', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(responsesApiEnvelope(JSON.stringify({ suggestions: [] })))
		);
		const provider = createOpenAiProvider({
			openaiApiKey: 'sk-secret-value',
			aiModel: 'gpt-5-mini'
		});
		await provider.extract(baseRequest());

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret-value');
		expect(init.body as string).not.toContain('sk-secret-value');
	});

	it('the outbound file part is named document.pdf and never the original filename', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(responsesApiEnvelope(JSON.stringify({ suggestions: [] })))
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await provider.extract(baseRequest());

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		const filePart = body.input[0].content.find((p: { type: string }) => p.type === 'input_file');
		expect(filePart.filename).toBe('document.pdf');
		expect(JSON.stringify(body)).not.toContain('original-filename');
	});

	it('sends an input_image part (no filename) for an image MIME type', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(responsesApiEnvelope(JSON.stringify({ suggestions: [] })))
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await provider.extract(
			baseRequest({ document: { mimeType: 'image/png', bytes: new Uint8Array([1]) } })
		);

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		const imagePart = body.input[0].content.find((p: { type: string }) => p.type === 'input_image');
		expect(imagePart).toBeTruthy();
		expect(imagePart.filename).toBeUndefined();
	});

	it('always sets store: false in the request body', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(responsesApiEnvelope(JSON.stringify({ suggestions: [] })))
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await provider.extract(baseRequest());

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.store).toBe(false);
	});

	it('parses valid structured output into suggestions', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				responsesApiEnvelope(
					JSON.stringify({
						suggestions: [
							{
								field_key: 'contract_end',
								value: '2027-12-31',
								source_text: 'Laufzeit bis 31.12.2027'
							}
						]
					})
				)
			)
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		const result = await provider.extract(baseRequest());
		expect(result.suggestions).toEqual([
			{
				fieldKey: 'contract_end',
				value: '2027-12-31',
				sourceText: 'Laufzeit bis 31.12.2027'
			}
		]);
		expect(result.providerId).toBe('openai');
	});

	it('parses source excerpts for additional suggestions', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				responsesApiEnvelope(
					JSON.stringify({
						suggestions: [],
						additional_suggestions: [
							{
								suggested_label: 'Rückflugnummer',
								suggested_type: 'text',
								value: 'DE1669',
								evidence: 'Rückflug DE1669, Heraklion nach Frankfurt'
							}
						]
					})
				)
			)
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		const result = await provider.extract(baseRequest());
		expect(result.additionalSuggestions).toEqual([
			{
				suggestedLabel: 'Rückflugnummer',
				suggestedType: 'text',
				value: 'DE1669',
				evidence: 'Rückflug DE1669, Heraklion nach Frankfurt'
			}
		]);
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		const outputSchema = body.text.format.schema;
		expect(outputSchema.properties.additional_suggestions.items.required).toContain('evidence');
	});

	it('maps action suggestions with a relative date into the application shape', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				responsesApiEnvelope(
					JSON.stringify({
						suggestions: [],
						action_suggestions: [
							{
								title: 'Versicherung kündigen',
								context: null,
								evidence: 'drei Monate vorher',
								status: 'OPEN',
								date: {
									kind: 'DUE_BY',
									value: null,
									relative: {
										relation: 'BEFORE',
										amount: 3,
										unit: 'MONTHS',
										anchor_field_key: 'contract_end'
									}
								}
							}
						]
					})
				)
			)
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		const result = await provider.extract(baseRequest());
		expect(result.actionSuggestions).toEqual([
			{
				title: 'Versicherung kündigen',
				context: null,
				evidence: 'drei Monate vorher',
				status: 'OPEN',
				date: {
					kind: 'DUE_BY',
					value: null,
					relative: {
						relation: 'BEFORE',
						amount: 3,
						unit: 'MONTHS',
						anchorFieldKey: 'contract_end',
						anchorDate: null,
						anchorLabel: null
					}
				}
			}
		]);
	});

	it('requires action_suggestions in the strict response schema sent to OpenAI', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(responsesApiEnvelope(JSON.stringify({ suggestions: [] })))
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await provider.extract(baseRequest());
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const schema = JSON.parse(init.body as string).text.format.schema;
		expect(schema.required).toContain('action_suggestions');
		expect(schema.properties.action_suggestions.items.required).toEqual([
			'title',
			'context',
			'evidence',
			'status',
			'date'
		]);
	});

	it('maps 401 to ExtractionUnavailableError', async () => {
		fetchMock.mockResolvedValue(jsonResponse({}, 401));
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionUnavailableError);
	});

	it('maps 403 to ExtractionUnavailableError', async () => {
		fetchMock.mockResolvedValue(jsonResponse({}, 403));
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionUnavailableError);
	});

	it('maps 429 to ExtractionRateLimitError', async () => {
		fetchMock.mockResolvedValue(jsonResponse({}, 429));
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionRateLimitError);
	});

	it('maps a 500 to ExtractionFailedError', async () => {
		fetchMock.mockResolvedValue(jsonResponse({}, 500));
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionFailedError);
	});

	it('maps a routing 429 to ExtractionRateLimitError', async () => {
		fetchMock.mockResolvedValue(jsonResponse({}, 429));
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.route(routingRequest())).rejects.toThrow(ExtractionRateLimitError);
	});

	it('maps a network error to ExtractionUnavailableError', async () => {
		fetchMock.mockRejectedValue(new TypeError('fetch failed'));
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionUnavailableError);
	});

	it('maps an abort/timeout error to ExtractionTimeoutError', async () => {
		const timeoutError = new Error('The operation was aborted');
		timeoutError.name = 'TimeoutError';
		fetchMock.mockRejectedValue(timeoutError);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionTimeoutError);
	});

	it('maps a non-JSON response body to ExtractionMalformedOutputError', async () => {
		fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionMalformedOutputError);
	});

	it('maps a timeout while reading the response body to ExtractionTimeoutError', async () => {
		const timeoutError = new Error('The operation was aborted');
		timeoutError.name = 'AbortError';
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: () => Promise.reject(timeoutError)
		});
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionTimeoutError);
	});

	it('maps a network failure while reading the response body to ExtractionUnavailableError', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: () => Promise.reject(new TypeError('body stream failed'))
		});
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionUnavailableError);
	});

	it('maps a response missing output_text to ExtractionMalformedOutputError', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ status: 'completed', output: [] }));
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionMalformedOutputError);
	});

	it('maps a top-level incomplete response status to ExtractionFailedError, never accepting a partial output_text', async () => {
		const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
		fetchMock.mockResolvedValue(
			jsonResponse({
				status: 'incomplete',
				incomplete_details: { reason: 'max_output_tokens' },
				usage: { input_tokens: 18000, output_tokens: 2000 },
				output: [
					{
						type: 'message',
						status: 'incomplete',
						content: [{ type: 'output_text', text: '{"suggestions": [{"field_key": "c' }]
					}
				]
			})
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionFailedError);
		expect(warn).toHaveBeenCalledWith(
			'ai extraction failed',
			expect.objectContaining({
				reason: 'incomplete_response',
				completionStatus: 'incomplete',
				inputTokens: 18000,
				outputTokens: 2000,
				providerActionCount: null
			})
		);
	});

	it('maps an incomplete message status (top-level completed) to ExtractionFailedError', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				status: 'completed',
				output: [
					{
						type: 'message',
						status: 'incomplete',
						content: [{ type: 'output_text', text: '{"suggestions": []}' }]
					}
				]
			})
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionFailedError);
	});

	it('maps a message with no status field at all to ExtractionFailedError, never treating an omitted status as trustworthy', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				status: 'completed',
				output: [
					{
						type: 'message',
						// deliberately no `status` field
						content: [{ type: 'output_text', text: '{"suggestions": []}' }]
					}
				]
			})
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionFailedError);
	});

	it('maps a refusal content part to ExtractionFailedError instead of parsing it as output', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				status: 'completed',
				output: [
					{
						type: 'message',
						status: 'completed',
						content: [{ type: 'refusal', refusal: 'I cannot help with that.' }]
					}
				]
			})
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionFailedError);
	});

	it('maps model output that is not JSON to ExtractionMalformedOutputError', async () => {
		fetchMock.mockResolvedValue(jsonResponse(responsesApiEnvelope('not valid json')));
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionMalformedOutputError);
	});

	it('maps model output with an extra confidence key to ExtractionMalformedOutputError', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				responsesApiEnvelope(
					JSON.stringify({
						suggestions: [{ field_key: 'contract_end', value: '2027-12-31', confidence: 0.9 }]
					})
				)
			)
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.extract(baseRequest())).rejects.toThrow(ExtractionMalformedOutputError);
	});

	it('rejects a routing response with an unexpected field', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				responsesApiEnvelope(
					JSON.stringify({
						document_kind: 'contract',
						playbook_matching_hints: [],
						item_matching_hints: [],
						confidence: 1
					})
				)
			)
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.route(routingRequest())).rejects.toThrow(ExtractionMalformedOutputError);
	});

	it('does not send installed Playbook metadata in the routing instruction', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				responsesApiEnvelope(
					JSON.stringify({
						document_kind: 'contract',
						playbook_matching_hints: ['Leasing'],
						item_matching_hints: []
					})
				)
			)
		);
		const provider = createOpenAiProvider({ openaiApiKey: 'k', aiModel: 'gpt-5-mini' });
		await expect(provider.route(routingRequest())).resolves.toMatchObject({
			playbookMatchingHints: ['Leasing']
		});
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(init.body as string).not.toContain('Leasing');
	});

	it('no log line contains the API key', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		fetchMock.mockResolvedValue(jsonResponse({}, 500));
		const provider = createOpenAiProvider({
			openaiApiKey: 'sk-should-never-be-logged',
			aiModel: 'gpt-5-mini'
		});
		await expect(provider.extract(baseRequest())).rejects.toThrow();
		for (const call of warnSpy.mock.calls) {
			expect(JSON.stringify(call)).not.toContain('sk-should-never-be-logged');
		}
		warnSpy.mockRestore();
	});
});
