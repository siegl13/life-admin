import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';

const { clock, history, runs, fields, items } = vi.hoisted(() => ({
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
		addAdditionalFields: vi.fn()
	},
	fields: { listFields: vi.fn().mockReturnValue([]) },
	items: { getItemById: vi.fn().mockReturnValue({ status: 'ACTIVE' }) }
}));

vi.mock('$lib/server/appPorts', () => ({
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
		runs.getById.mockReturnValue({ id: RUN, itemId: A, cycleId: 'cycle-1', status: 'NEW' });
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
				payload: JSON.stringify({ acceptedCount: 1 })
			})
		);
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
				payload: JSON.stringify({ acceptedCount: 1 })
			})
		);
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
