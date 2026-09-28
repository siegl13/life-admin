import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import type { ItemRelationRepositoryPort } from '$lib/application/ports';

const { clock, relations, history, cycles, fields, schedule, items, snoozes, whatsNext } =
	vi.hoisted(() => ({
		clock: {
			nowIso: () => '2026-01-01T00:00:00.000Z',
			todayIso: () => '2026-06-03',
			localHour: () => 9
		},
		relations: {
			link: vi.fn(),
			unlink: vi.fn(),
			listRelated: vi.fn(),
			listCandidates: vi.fn(),
			countRelated: vi.fn(),
			deleteForItem: vi.fn(),
			get: vi.fn()
		},
		history: {
			insert: vi.fn(),
			listByItem: vi.fn().mockReturnValue([]),
			countByItem: vi.fn().mockReturnValue(0),
			deleteForItem: vi.fn()
		},
		cycles: { getActiveCycle: vi.fn() },
		fields: { listFields: vi.fn() },
		schedule: { applyFieldUpdatesAndRecalculate: vi.fn() },
		items: { getItemById: vi.fn() },
		snoozes: { get: vi.fn(), set: vi.fn(), clearIfVersion: vi.fn(), list: vi.fn() },
		whatsNext: { loadItems: vi.fn() }
	}));

vi.mock('$lib/server/appPorts', () => ({
	actionsPort: {},
	appSettingsPort: {},
	attachmentStoragePort: {},
	attachmentsPort: {},
	clock,
	cyclesPort: cycles,
	eventsPort: {},
	extractionRunsPort: {},
	fieldsPort: fields,
	idsPort: { newId: () => 'test-id' },
	itemRelationsPort: relations,
	itemHistoryPort: history,
	itemsPort: items,
	notificationSnoozesPort: snoozes,
	playbooksPort: {},
	scheduleRepositoryPort: schedule,
	whatsNextPort: whatsNext
}));

import { actions } from './+page.server';
import { resolveHistoryLimit } from '$lib/application/history/historyPagination';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const relationPort = relations as ItemRelationRepositoryPort & {
	link: ReturnType<typeof vi.fn>;
	unlink: ReturnType<typeof vi.fn>;
	countRelated: ReturnType<typeof vi.fn>;
};

function linkRequest(relatedItemId: string): Request {
	const form = new FormData();
	form.set('relatedItemId', relatedItemId);
	return new Request('http://localhost/items/' + A, { method: 'POST', body: form });
}

async function link(relatedItemId: string) {
	return actions.linkItem({ request: linkRequest(relatedItemId), params: { id: A } } as never);
}

function unlinkRequest(relatedItemId: string, query = ''): Request {
	const form = new FormData();
	form.set('relatedItemId', relatedItemId);
	form.set('q', query);
	return new Request('http://localhost/items/' + A, { method: 'POST', body: form });
}

async function unlink(relatedItemId: string, query?: string) {
	return actions.unlinkItem({
		request: unlinkRequest(relatedItemId, query),
		params: { id: A }
	} as never);
}

describe('item relation action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		relationPort.link.mockReturnValue('LINKED');
		relationPort.unlink.mockReturnValue('UNLINKED');
		relationPort.countRelated.mockReturnValue(1);
	});

	it('rejects malformed and self links before persistence', async () => {
		for (const relatedItemId of ['malformed', A]) {
			const result = await link(relatedItemId);
			expect(result).toMatchObject({ status: 400 });
		}
		expect(relationPort.link).not.toHaveBeenCalled();
	});

	it('rejects missing, duplicate, and archived relations without redirecting', async () => {
		for (const result of ['MISSING_ITEM', 'DUPLICATE', 'ARCHIVED_ITEM'] as const) {
			relationPort.link.mockReturnValueOnce(result);
			const response = await link(B);
			expect(response).toMatchObject({ status: 400 });
		}
	});

	it('redirects after a valid link', async () => {
		let caught: unknown;
		try {
			await link(B);
		} catch (thrown) {
			caught = thrown;
		}

		expect(isRedirect(caught)).toBe(true);
		expect(caught).toMatchObject({
			status: 303,
			location: `/items/${A}?manage=relations#relations`
		});
	});

	it('rejects malformed unlink requests before persistence', async () => {
		const result = await unlink('malformed');

		expect(result).toMatchObject({ status: 400 });
		expect(relationPort.unlink).not.toHaveBeenCalled();
	});

	it('rejects missing, archived, and absent relations without redirecting', async () => {
		for (const result of ['MISSING_ITEM', 'ARCHIVED_ITEM', 'NOT_LINKED'] as const) {
			relationPort.unlink.mockReturnValueOnce(result);
			const response = await unlink(B);
			expect(response).toMatchObject({ status: 400 });
		}
	});

	it('uses the same outward error for archived-source unlink targets that exist or are missing', async () => {
		relationPort.unlink.mockReturnValueOnce('ARCHIVED_ITEM').mockReturnValueOnce('MISSING_ITEM');

		const existingTarget = await unlink(B);
		const missingTarget = await unlink('10000000-0000-4000-8000-000000000099');

		expect(existingTarget).toEqual(missingTarget);
		expect(existingTarget).toMatchObject({ status: 400 });
	});

	it('redirects to the relation section after removing the final relation', async () => {
		relationPort.countRelated.mockReturnValue(0);
		let caught: unknown;
		try {
			await unlink(B, 'kept search');
		} catch (thrown) {
			caught = thrown;
		}

		expect(relationPort.unlink).toHaveBeenCalledWith(A, B);
		expect(isRedirect(caught)).toBe(true);
		expect(caught).toMatchObject({ status: 303, location: `/items/${A}#relations` });
	});

	it('preserves normalized manage and search state after unlinking', async () => {
		let caught: unknown;
		try {
			await unlink(B, ' Kept   Search ');
		} catch (thrown) {
			caught = thrown;
		}

		expect(isRedirect(caught)).toBe(true);
		expect(caught).toMatchObject({
			status: 303,
			location: `/items/${A}?manage=relations&q=kept+search#relations`
		});
	});
});

function textField(value: string | null) {
	return {
		id: 'field-1',
		cycleId: 'cycle-1',
		fieldKey: 'notes',
		label: 'Notes',
		type: 'text' as const,
		origin: 'CUSTOM' as const,
		recommended: false,
		position: 0,
		value
	};
}

function updateFieldsRequest(value: string): Request {
	const form = new FormData();
	form.set('field:notes', value);
	return new Request('http://localhost/items/' + A, { method: 'POST', body: form });
}

async function updateFields(value: string) {
	return actions.updateFields({
		request: updateFieldsRequest(value),
		params: { id: A }
	} as never);
}

describe('resolveHistoryLimit (history pagination)', () => {
	it('defaults to the desktop page size with no historyCount', () => {
		expect(resolveHistoryLimit(null)).toBe(10);
	});

	it('ignores a historyCount at or below the default page size', () => {
		expect(resolveHistoryLimit('5')).toBe(10);
		expect(resolveHistoryLimit('10')).toBe(10);
	});

	it('grows the fetch window to a larger requested historyCount', () => {
		expect(resolveHistoryLimit('25')).toBe(25);
	});

	it('caps an excessive historyCount instead of fetching unbounded rows', () => {
		expect(resolveHistoryLimit('1000000')).toBe(500);
	});

	it('ignores a non-numeric historyCount', () => {
		expect(resolveHistoryLimit('not-a-number')).toBe(10);
	});
});

describe('updateFields action (history recording)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		items.getItemById.mockReturnValue({ status: 'ACTIVE' });
		cycles.getActiveCycle.mockReturnValue({ id: 'cycle-1' });
	});

	it('does not record a FIELD_CHANGED event when the resubmitted value is unchanged', async () => {
		fields.listFields.mockReturnValue([textField('same value')]);

		let caught: unknown;
		try {
			await updateFields('same value');
		} catch (thrown) {
			caught = thrown;
		}

		expect(isRedirect(caught)).toBe(true);
		expect(history.insert).not.toHaveBeenCalled();
	});

	it('records exactly one FIELD_CHANGED event when the value actually changes', async () => {
		fields.listFields
			.mockReturnValueOnce([textField('old value')]) // pre-write snapshot
			.mockReturnValueOnce([textField('old value')]) // normalizeFieldUpdates' type lookup
			.mockReturnValueOnce([textField('new value')]); // post-write snapshot

		let caught: unknown;
		try {
			await updateFields('new value');
		} catch (thrown) {
			caught = thrown;
		}

		expect(isRedirect(caught)).toBe(true);
		expect(history.insert).toHaveBeenCalledTimes(1);
		expect(history.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'FIELD_CHANGED',
				payload: JSON.stringify({ fieldKey: 'notes' })
			})
		);
	});
});

function snoozeRequest(actionId: string, snoozedUntil: string): Request {
	const form = new FormData();
	form.set('actionId', actionId);
	form.set('snoozedUntil', snoozedUntil);
	return new Request('http://localhost/items/' + A, { method: 'POST', body: form });
}

describe('snooze actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		items.getItemById.mockReturnValue({ status: 'ACTIVE' });
	});

	it('rejects an invalid snooze date before persistence', async () => {
		const result = await actions.setSnooze({
			request: snoozeRequest('action-1', '2020-01-01'),
			params: { id: A }
		} as never);

		expect(result).toMatchObject({ status: 400 });
		expect(snoozes.set).not.toHaveBeenCalled();
	});

	it('rejects snoozing an archived item and leaves the snooze unchanged', async () => {
		items.getItemById.mockReturnValue({ status: 'ARCHIVED' });
		const result = await actions.setSnooze({
			request: snoozeRequest('action-1', 'TOMORROW'),
			params: { id: A }
		} as never);

		expect(result).toMatchObject({ status: 400 });
		expect(snoozes.set).not.toHaveBeenCalled();
	});

	it('rejects snoozing an action belonging to another item', async () => {
		whatsNext.loadItems.mockReturnValue([
			{
				itemId: B,
				title: 'Other item',
				actions: [
					{
						actionId: 'action-1',
						label: 'Action',
						dueDate: '2026-06-10',
						dueKind: 'MANUAL',
						dueOverrideDate: null,
						state: 'OPEN',
						position: 0,
						dependencyStates: []
					}
				]
			}
		]);

		const result = await actions.setSnooze({
			request: snoozeRequest('action-1', 'TOMORROW'),
			params: { id: A }
		} as never);

		expect(result).toMatchObject({ status: 400 });
		expect(snoozes.set).not.toHaveBeenCalled();
	});

	it('clears a snooze through the authenticated item action', async () => {
		const current = {
			actionId: 'action-1',
			sourceDueDate: '2026-06-10',
			snoozedUntil: '2026-06-05',
			version: 'version-1'
		};
		snoozes.get.mockReturnValue(current);
		whatsNext.loadItems.mockReturnValue([
			{
				itemId: A,
				title: 'Item',
				actions: [
					{
						actionId: 'action-1',
						label: 'Action',
						state: 'OPEN',
						dueKind: 'MANUAL',
						dueDate: '2026-06-10',
						dueOverrideDate: null,
						position: 0,
						dependencyStates: []
					}
				]
			}
		]);

		let caught: unknown;
		try {
			const form = new FormData();
			form.set('actionId', 'action-1');
			await actions.clearSnooze({
				request: new Request('http://localhost/items/' + A, { method: 'POST', body: form }),
				params: { id: A }
			} as never);
		} catch (thrown) {
			caught = thrown;
		}

		expect(isRedirect(caught)).toBe(true);
		expect(snoozes.clearIfVersion).toHaveBeenCalledWith('action-1', 'version-1');
	});

	it('does not clear an action belonging to another item', async () => {
		snoozes.get.mockReturnValue({
			actionId: 'action-1',
			sourceDueDate: '2026-06-10',
			snoozedUntil: '2026-06-05',
			version: 'version-1'
		});
		whatsNext.loadItems.mockReturnValue([
			{
				itemId: B,
				title: 'Other item',
				actions: [
					{
						actionId: 'action-1',
						label: 'Action',
						dueDate: '2026-06-10',
						dueKind: 'MANUAL',
						dueOverrideDate: null,
						state: 'OPEN',
						position: 0,
						dependencyStates: []
					}
				]
			}
		]);
		const form = new FormData();
		form.set('actionId', 'action-1');

		let caught: unknown;
		try {
			await actions.clearSnooze({
				request: new Request('http://localhost/items/' + A, { method: 'POST', body: form }),
				params: { id: A }
			} as never);
		} catch (thrown) {
			caught = thrown;
		}

		expect(isRedirect(caught)).toBe(true);
		expect(snoozes.clearIfVersion).not.toHaveBeenCalled();
	});
});
