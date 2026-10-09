import { describe, expect, it, vi } from 'vitest';
import { isRedirect, type Cookies } from '@sveltejs/kit';
import type { Action } from '$lib/domain/action/action';

const { clock, actionsPort, itemHistoryPort, whatsNextPort, inboxPort } = vi.hoisted(() => ({
	clock: {
		nowIso: () => '2026-01-01T00:00:00.000Z',
		todayIso: () => '2026-01-01',
		localHour: () => 9
	},
	actionsPort: { setActionState: vi.fn() },
	itemHistoryPort: { insert: vi.fn() },
	whatsNextPort: { loadItems: vi.fn().mockReturnValue([]) },
	inboxPort: { listPending: vi.fn().mockReturnValue([]) }
}));

vi.mock('$lib/server/appPorts', () => ({
	actionsPort,
	clock,
	idsPort: { newId: () => 'history-1' },
	itemHistoryPort,
	whatsNextPort,
	inboxPort
}));

vi.mock('$lib/server/config', () => ({ config: { cookieSecure: false } }));

import { actions, load } from './+page.server';

const UNDO_COOKIE = 'whatsnext_undo';

function fakeCookies(initial: Record<string, string> = {}): Cookies {
	const store = new Map(Object.entries(initial));
	return {
		get: (name: string) => store.get(name),
		getAll: () =>
			[...store.entries()].map(([name, value]) => ({ name, value, options: undefined })),
		set: (name: string, value: string) => {
			store.set(name, value);
		},
		delete: (name: string) => {
			store.delete(name);
		},
		serialize: () => ''
	} as unknown as Cookies;
}

function completeRequest(itemId: string, actionId: string): Request {
	const form = new FormData();
	form.set('itemId', itemId);
	form.set('actionId', actionId);
	return new Request('http://localhost/', { method: 'POST', body: form });
}

async function redirectOf(promise: unknown): Promise<unknown> {
	let caught: unknown;
	try {
		await promise;
	} catch (thrown) {
		caught = thrown;
	}
	expect(isRedirect(caught)).toBe(true);
	return caught;
}

describe('root undo cookie bounds a long or multibyte label', () => {
	it('truncates a very long ASCII label, keeps full identity, and a later undo still works', async () => {
		const longLabel = 'x'.repeat(5000);
		actionsPort.setActionState.mockReturnValueOnce({ id: 'a1', label: longLabel } as Action);
		const cookies = fakeCookies();
		const setCookie = vi.spyOn(cookies, 'set');

		await redirectOf(
			actions.completeAction({ request: completeRequest('item-1', 'a1'), cookies } as never)
		);

		const raw = cookies.get(UNDO_COOKIE)!;
		expect(setCookie).toHaveBeenCalledWith(
			UNDO_COOKIE,
			expect.any(String),
			expect.objectContaining({
				httpOnly: true,
				sameSite: 'lax',
				secure: false,
				maxAge: 120
			})
		);
		expect(raw.length).toBeLessThan(300);
		const parsed = JSON.parse(raw);
		expect(parsed).toMatchObject({ itemId: 'item-1', actionId: 'a1' });
		expect(parsed.label.length).toBeLessThanOrEqual(101);
		expect(parsed.label.endsWith('…')).toBe(true);

		actionsPort.setActionState.mockReturnValueOnce({ id: 'a1', label: 'reopened' } as Action);
		await redirectOf(
			actions.undoAction({
				request: completeRequest('item-1', 'a1'),
				cookies
			} as never)
		);
		expect(actionsPort.setActionState).toHaveBeenLastCalledWith('item-1', 'a1', 'OPEN');
		expect(cookies.get(UNDO_COOKIE)).toBeUndefined();
	});

	it('truncates a multibyte label without splitting a surrogate pair', async () => {
		const emojiLabel = '🎉'.repeat(200);
		actionsPort.setActionState.mockReturnValueOnce({ id: 'a2', label: emojiLabel } as Action);
		const cookies = fakeCookies();

		await redirectOf(
			actions.completeAction({ request: completeRequest('item-2', 'a2'), cookies } as never)
		);

		const raw = cookies.get(UNDO_COOKIE)!;
		expect(Buffer.byteLength(encodeURIComponent(raw))).toBeLessThan(3800);
		const parsed = JSON.parse(raw);
		expect(Array.from(parsed.label as string).length).toBeLessThanOrEqual(101);
		// A split surrogate pair would decode to U+FFFD or throw on re-encode;
		// neither happens here.
		expect(parsed.label).not.toMatch(/�/);
		expect(() => encodeURIComponent(parsed.label)).not.toThrow();
	});

	it('keeps the stored Action.label itself untouched — only the flash display copy is bounded', async () => {
		const longLabel = 'y'.repeat(300);
		actionsPort.setActionState.mockReturnValueOnce({ id: 'a3', label: longLabel } as Action);
		const cookies = fakeCookies();

		await redirectOf(
			actions.completeAction({ request: completeRequest('item-3', 'a3'), cookies } as never)
		);

		expect(actionsPort.setActionState).toHaveBeenCalledWith('item-3', 'a3', 'DONE');
		const parsed = JSON.parse(cookies.get(UNDO_COOKIE)!);
		expect(parsed.label).not.toBe(longLabel);
		expect(parsed.label.length).toBeLessThan(longLabel.length);
	});
});

describe('root load projects a deterministic filtered-empty view', () => {
	it('an active filter with zero matches returns an empty (not omitted) section, independent of shared suite state', () => {
		// One Item with a single overdue, undated-of-nothing-else action: the
		// "later" bucket has zero matches for this controlled fixture,
		// regardless of what else exists in a real shared database.
		whatsNextPort.loadItems.mockReturnValueOnce([
			{
				itemId: 'item-9',
				title: 'Only overdue',
				actions: [
					{
						actionId: 'a9',
						label: 'Overdue action',
						state: 'OPEN',
						dueKind: 'MANUAL',
						dueDate: '2020-01-01',
						dueOverrideDate: null,
						position: 0,
						dependencyStates: []
					}
				]
			}
		]);

		const result = load({
			url: new URL('http://localhost/?filter=later'),
			cookies: fakeCookies()
		} as never) as {
			filter: string;
			counts: { all: number; overdue: number; now: number; later: number };
			sections: { bucket: number; groups: unknown[] }[];
		};

		expect(result.filter).toBe('later');
		expect(result.counts).toEqual({ all: 1, overdue: 1, now: 0, later: 0 });
		expect(result.sections).toEqual([{ bucket: 2, groups: [] }]);
	});

	it('shares one loaded working set with the weekly panel and reads the pending Inbox count', () => {
		const items = [
			{
				itemId: 'item-week',
				title: 'Weekly item',
				actions: [
					{
						actionId: 'action-week',
						label: 'Pay bill',
						state: 'OPEN',
						dueKind: 'MANUAL',
						dueDate: '2026-01-01',
						dueOverrideDate: null,
						position: 0,
						dependencyStates: []
					}
				]
			}
		];
		whatsNextPort.loadItems.mockReturnValueOnce(items);
		inboxPort.listPending.mockReturnValueOnce([{}, {}]);

		const result = load({
			url: new URL('http://localhost/'),
			cookies: fakeCookies()
		} as never) as {
			weeklyOverview: { actionId: string; dueDate: string }[];
			inboxCount: number;
		};

		expect(result.weeklyOverview).toEqual([
			{
				itemId: 'item-week',
				itemTitle: 'Weekly item',
				actionId: 'action-week',
				label: 'Pay bill',
				dueDate: '2026-01-01'
			}
		]);
		expect(result.inboxCount).toBe(2);
		expect(whatsNextPort.loadItems).toHaveBeenCalledTimes(1);
		expect(inboxPort.listPending).toHaveBeenCalledTimes(1);
	});
});

describe('root reopenAction adapter', () => {
	it('reopens via the same shared transition helper as completeAction/skipAction, by itemId+actionId form fields', async () => {
		actionsPort.setActionState.mockReturnValueOnce({ id: 'a4', label: 'x' } as Action);
		const cookies = fakeCookies();

		await redirectOf(
			actions.reopenAction({ request: completeRequest('item-4', 'a4'), cookies } as never)
		);

		expect(actionsPort.setActionState).toHaveBeenCalledWith('item-4', 'a4', 'OPEN');
		expect(itemHistoryPort.insert).toHaveBeenCalledWith(
			expect.objectContaining({ itemId: 'item-4', eventType: 'ACTION_REOPENED' })
		);
	});
});

describe('root undoAction rejects an unsafe cookie without crashing', () => {
	it('rejects a notice replaced by another tab without reopening or consuming the newer action', async () => {
		const newer = JSON.stringify({ itemId: 'item-2', actionId: 'a2', label: 'Newer action' });
		const cookies = fakeCookies({ whatsnext_undo: newer });
		const result = await actions.undoAction({
			request: completeRequest('item-1', 'a1'),
			cookies
		} as never);
		expect(result).toMatchObject({ status: 400 });
		expect(actionsPort.setActionState).not.toHaveBeenCalled();
		expect(cookies.get(UNDO_COOKIE)).toBe(newer);
	});
	it('a non-JSON cookie value is treated as "no undo available", not a 500', async () => {
		const cookies = fakeCookies({ whatsnext_undo: 'not-json-at-all{' });

		const result = await actions.undoAction({
			request: new Request('http://localhost/', { method: 'POST' }),
			cookies
		} as never);

		expect(result).toMatchObject({ status: 400 });
		expect(actionsPort.setActionState).not.toHaveBeenCalled();
	});

	it('a JSON cookie missing required fields is treated as "no undo available", not a 500', async () => {
		const cookies = fakeCookies({ whatsnext_undo: JSON.stringify({ itemId: 'only-this' }) });

		const result = await actions.undoAction({
			request: new Request('http://localhost/', { method: 'POST' }),
			cookies
		} as never);

		expect(result).toMatchObject({ status: 400 });
		expect(actionsPort.setActionState).not.toHaveBeenCalled();
	});
});
