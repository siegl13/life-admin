import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';

const { clock, history, runs, fields, items, actionsRepo } = vi.hoisted(() => ({
	actionsRepo: { listActions: vi.fn().mockReturnValue([]) },
	clock: { nowIso: () => '2026-01-01T00:00:00.000Z' },
	history: {
		insert: vi.fn(),
		listByItem: vi.fn().mockReturnValue([]),
		countByItem: vi.fn().mockReturnValue(0),
		deleteForItem: vi.fn()
	},
	runs: {
		getById: vi.fn(),
		listSuggestions: vi.fn().mockReturnValue([]),
		applyRun: vi.fn(),
		addAdditionalFields: vi.fn(),
		listActionSuggestions: vi.fn().mockReturnValue([]),
		addActions: vi.fn()
	},
	fields: { listFields: vi.fn().mockReturnValue([]) },
	items: { getItemById: vi.fn().mockReturnValue({ status: 'ACTIVE' }) }
}));

vi.mock('$lib/server/appPorts', () => ({
	actionsPort: actionsRepo,
	attachmentsPort: {},
	clock,
	extractionRunsPort: runs,
	fieldsPort: fields,
	idsPort: { newId: () => 'test-id' },
	itemHistoryPort: history,
	itemsPort: items
}));

import { actions } from './+page.server';

const A = '10000000-0000-4000-8000-000000000001';
const RUN = '20000000-0000-4000-8000-000000000001';

function applyRequest(body: Record<string, string>): Request {
	const form = new FormData();
	for (const [key, value] of Object.entries(body)) form.set(key, value);
	return new Request('http://localhost/items/' + A + '/suggestions/' + RUN, {
		method: 'POST',
		body: form
	});
}

async function apply(body: Record<string, string>) {
	return actions.apply({ request: applyRequest(body), params: { id: A, runId: RUN } } as never);
}

describe('applied AI suggestions history recording', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		runs.getById.mockReturnValue({
			id: RUN,
			itemId: A,
			cycleId: 'cycle-1',
			status: 'NEW',
			attachmentId: null
		});
		runs.listSuggestions.mockReturnValue([
			{ fieldKey: 'contract_end', value: '2031-03-15', position: 0, accepted: false }
		]);
		fields.listFields.mockReturnValue([
			{ fieldKey: 'contract_end', label: 'Contract end', type: 'date', value: null }
		]);
	});

	it('records one AI_SUGGESTIONS_ACCEPTED event with the accepted count after a successful accept', async () => {
		let caught: unknown;
		try {
			await apply({ 'accept:contract_end': 'on' });
		} catch (thrown) {
			caught = thrown;
		}

		expect(isRedirect(caught)).toBe(true);
		expect(history.insert).toHaveBeenCalledTimes(1);
		expect(history.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'AI_SUGGESTIONS_ACCEPTED',
				payload: JSON.stringify({ acceptedCount: 1, source: 'DOCUMENT' })
			})
		);
	});

	it('records the source document id, never its name, when the run still has its attachment', async () => {
		runs.getById.mockReturnValue({
			id: RUN,
			itemId: A,
			cycleId: 'cycle-1',
			status: 'NEW',
			attachmentId: 'att-1',
			sourceFilename: 'secret-name.pdf'
		});

		await expect(apply({ 'accept:contract_end': 'on' })).rejects.toMatchObject({
			status: 303,
			location: `/items/${A}`
		});

		const payload = history.insert.mock.calls[0][0].payload as string;
		expect(JSON.parse(payload)).toEqual({
			acceptedCount: 1,
			source: 'DOCUMENT',
			attachmentId: 'att-1'
		});
		expect(payload).not.toContain('secret-name');
	});

	it('does not take the document id from a run of another item', async () => {
		runs.getById.mockReturnValue({
			id: RUN,
			itemId: 'other-item',
			cycleId: 'cycle-1',
			status: 'NEW',
			attachmentId: 'att-foreign'
		});

		await expect(apply({ 'accept:contract_end': 'on' })).rejects.toMatchObject({ status: 404 });
		expect(runs.applyRun).not.toHaveBeenCalled();
		expect(history.insert).not.toHaveBeenCalled();
	});

	it('keeps the already-recorded event for a sub-operation that committed, even when the next one fails', async () => {
		// The additional-field add commits and gets its own event; the
		// known-field accept then fails validation (its field no longer
		// exists) — the first event must survive, not be lost because the
		// whole action ends in a fail(400) (see review round-02 finding 2).
		fields.listFields.mockReturnValue([]);

		const response = await apply({
			'add:sug-1': 'on',
			'label:sug-1': 'Custom Field',
			'type:sug-1': 'text',
			'value:sug-1': 'x',
			'accept:contract_end': 'on'
		});

		expect(response).toMatchObject({ status: 400 });
		expect(runs.addAdditionalFields).toHaveBeenCalledTimes(1);
		expect(runs.applyRun).not.toHaveBeenCalled();
		expect(history.insert).toHaveBeenCalledTimes(1);
		expect(history.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'AI_SUGGESTIONS_ACCEPTED',
				payload: JSON.stringify({ acceptedCount: 1, source: 'DOCUMENT' })
			})
		);
	});

	it('does not overwrite a conflicting value that is only selected, and records no event', async () => {
		fields.listFields.mockReturnValue([
			{ fieldKey: 'contract_end', label: 'Contract end', type: 'date', value: '2030-01-01' }
		]);

		let caught: unknown;
		try {
			await apply({ 'accept:contract_end': 'on', 'resolve:contract_end': 'keep' });
		} catch (thrown) {
			caught = thrown;
		}

		expect(isRedirect(caught)).toBe(true);
		expect(runs.applyRun).toHaveBeenCalledWith(expect.objectContaining({ updates: [] }));
		expect(history.insert).not.toHaveBeenCalled();
	});

	it('replaces a conflicting value only on the explicit "replace" choice and records the actual change', async () => {
		fields.listFields.mockReturnValue([
			{ fieldKey: 'contract_end', label: 'Contract end', type: 'date', value: '2030-01-01' }
		]);

		try {
			await apply({ 'resolve:contract_end': 'replace' });
		} catch {
			// redirect
		}

		expect(runs.applyRun).toHaveBeenCalledWith(
			expect.objectContaining({ updates: [{ fieldKey: 'contract_end', value: '2031-03-15' }] })
		);
		expect(history.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'AI_SUGGESTIONS_ACCEPTED',
				payload: JSON.stringify({ acceptedCount: 1, source: 'DOCUMENT' })
			})
		);
	});

	it('accept all takes new values, leaves a posted replace choice unresolved', async () => {
		fields.listFields.mockReturnValue([
			{ fieldKey: 'contract_end', label: 'Contract end', type: 'date', value: '2030-01-01' },
			{ fieldKey: 'note', label: 'Note', type: 'text', value: null }
		]);
		runs.listSuggestions.mockReturnValue([
			{ fieldKey: 'contract_end', value: '2031-03-15', position: 0, accepted: false },
			{ fieldKey: 'note', value: 'hello', position: 1, accepted: false }
		]);

		try {
			await apply({ intent: 'acceptAll', 'resolve:contract_end': 'replace' });
		} catch {
			// redirect
		}

		expect(runs.applyRun).toHaveBeenCalledWith(
			expect.objectContaining({ updates: [{ fieldKey: 'note', value: 'hello' }] })
		);
	});

	it('creates no Action unless a suggestion is explicitly selected', async () => {
		runs.listActionSuggestions.mockReturnValue([
			{
				id: 'act-1',
				title: 'Unterlagen einreichen',
				context: null,
				evidence: null,
				date: { kind: 'NONE', value: null, relative: null },
				position: 0,
				accepted: false
			}
		]);

		try {
			await apply({});
		} catch {
			// redirect
		}

		expect(runs.addActions).not.toHaveBeenCalled();
		expect(history.insert).not.toHaveBeenCalled();
	});

	it('creates the selected Action as an ordinary Action and records one ACTION_ADDED event', async () => {
		runs.listActionSuggestions.mockReturnValue([
			{
				id: 'act-1',
				title: 'Unterlagen einreichen',
				context: 'Per Post',
				evidence: 'bis 1. März',
				date: { kind: 'DUE_BY', value: '2031-03-01', relative: null },
				position: 0,
				accepted: false
			},
			{
				id: 'act-2',
				title: 'Nicht ausgewählt',
				context: null,
				evidence: null,
				date: { kind: 'NONE', value: null, relative: null },
				position: 1,
				accepted: false
			}
		]);

		try {
			await apply({ 'action:act-1': 'on' });
		} catch {
			// redirect
		}

		expect(runs.addActions).not.toHaveBeenCalled();
		expect(runs.applyRun).toHaveBeenCalledWith(
			expect.objectContaining({
				actions: [
					{
						suggestionId: 'act-1',
						label: 'Unterlagen einreichen',
						description: 'Per Post',
						dueDate: '2031-03-01'
					}
				]
			})
		);
		expect(history.insert).toHaveBeenCalledTimes(1);
		expect(history.insert).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'ACTION_ADDED', payload: '{}' })
		);
	});

	it('anchors a relative Action date on the explicitly replaced field value that is saved with it', async () => {
		fields.listFields.mockReturnValue([
			{ fieldKey: 'contract_end', label: 'Contract end', type: 'date', value: '2030-01-01' }
		]);
		runs.listActionSuggestions.mockReturnValue([
			{
				id: 'act-1',
				title: 'Kündigung senden',
				context: null,
				evidence: null,
				date: {
					kind: 'DUE_BY',
					value: null,
					relative: {
						relation: 'BEFORE',
						amount: 10,
						unit: 'DAYS',
						anchorFieldKey: 'contract_end'
					}
				},
				position: 0,
				accepted: false
			}
		]);

		try {
			await apply({ 'resolve:contract_end': 'replace', 'action:act-1': 'on' });
		} catch {
			// redirect
		}

		// 2031-03-15 (replacement) minus 10 days, not 2030-01-01 minus 10 days.
		expect(runs.applyRun).toHaveBeenCalledWith(
			expect.objectContaining({
				updates: [{ fieldKey: 'contract_end', value: '2031-03-15' }],
				actions: [expect.objectContaining({ dueDate: '2031-03-05' })]
			})
		);
	});

	it('creates no Action and records no ACTION_ADDED event when a selected field no longer exists', async () => {
		fields.listFields.mockReturnValue([]);
		runs.listActionSuggestions.mockReturnValue([
			{
				id: 'act-1',
				title: 'Kündigung senden',
				context: null,
				evidence: null,
				date: { kind: 'NONE', value: null, relative: null },
				position: 0,
				accepted: false
			}
		]);

		const response = await apply({ 'accept:contract_end': 'on', 'action:act-1': 'on' });

		expect(response).toMatchObject({ status: 400 });
		expect(runs.applyRun).not.toHaveBeenCalled();
		expect(runs.addActions).not.toHaveBeenCalled();
		expect(history.insert).not.toHaveBeenCalled();
	});

	it('records no event when nothing was actually accepted', async () => {
		let caught: unknown;
		try {
			await apply({});
		} catch (thrown) {
			caught = thrown;
		}

		expect(isRedirect(caught)).toBe(true);
		expect(history.insert).not.toHaveBeenCalled();
	});
});
