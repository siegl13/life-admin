import { fail, redirect, type Cookies } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { config } from '$lib/server/config';
import { getWhatsNext } from '$lib/application/whatsnext/getWhatsNext';
import { getItemWorkflow } from '$lib/application/items/getItemWorkflow';
import {
	applyGuardedDueOverride,
	applyGuardedTransition,
	isDueOverrideEligible,
	isTransitionFailure,
	parseDueOverrideFormData,
	parseTransitionFormData
} from '$lib/server/http/actionTransition';
import {
	actionsPort,
	clock,
	cyclesPort,
	eventsPort,
	fieldsPort,
	idsPort,
	itemHistoryPort,
	whatsNextPort
} from '$lib/server/appPorts';
import {
	countWhatsNextActions,
	parseWhatsNextFilter,
	projectWhatsNextSections
} from '$lib/ui/whatsNextView';
import type { Actions, PageServerLoad } from './$types';

const UNDO_COOKIE = 'whatsnext_undo';
const UNDO_MAX_AGE_SECONDS = 120;
// Bounds the serialized cookie well under any browser's per-cookie size
// limit regardless of label length — itemId/actionId are fixed-length
// UUIDs, so the label is the only unbounded input here (Action labels
// have no stored max length; see addManualAction). Only the flash's
// DISPLAY copy is truncated — the actual stored Action.label is untouched.
const UNDO_LABEL_MAX_CHARS = 100;

interface UndoFlash {
	itemId: string;
	actionId: string;
	label: string;
}

/** Truncates by Unicode code point, not UTF-16 code unit, so a multibyte
 *  label (emoji, astral characters) is never cut through a surrogate
 *  pair into invalid/mismatched halves. */
function truncateUndoLabel(label: string): string {
	const chars = Array.from(label);
	if (chars.length <= UNDO_LABEL_MAX_CHARS) return label;
	return chars.slice(0, UNDO_LABEL_MAX_CHARS).join('') + '…';
}

function parseUndoFlash(raw: string | undefined): UndoFlash | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (
			parsed &&
			typeof parsed.itemId === 'string' &&
			typeof parsed.actionId === 'string' &&
			typeof parsed.label === 'string'
		) {
			return parsed;
		}
	} catch {
		// Malformed/tampered cookie: treat exactly like "no undo available".
	}
	return null;
}

/** Read-only: the root page can render its undo notice on every view
 *  until the cookie's own short `maxAge` expires, or until `undoAction`
 *  consumes it (see below) — a GET must never itself invalidate the
 *  undo the next POST still needs. */
function peekUndoFlash(cookies: Cookies): UndoFlash | null {
	return parseUndoFlash(cookies.get(UNDO_COOKIE));
}

/** Consumes the flash: whether or not it parses, the cookie must not
 *  outlive this request once `undoAction` has looked at it. */
function consumeUndoFlash(cookies: Cookies): UndoFlash | null {
	const raw = cookies.get(UNDO_COOKIE);
	cookies.delete(UNDO_COOKIE, { path: '/' });
	return parseUndoFlash(raw);
}

function writeUndoFlash(cookies: Cookies, flash: UndoFlash): void {
	cookies.set(UNDO_COOKIE, JSON.stringify(flash), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: config.cookieSecure,
		maxAge: UNDO_MAX_AGE_SECONDS
	});
}

function currentDueOverrideEligibility(itemId: string, actionId: string): boolean {
	const workflow = getItemWorkflow(
		{ cycles: cyclesPort, actions: actionsPort, events: eventsPort, fields: fieldsPort },
		itemId
	);
	const action = workflow?.find((entry) => entry.action.id === actionId)?.action ?? null;
	return isDueOverrideEligible(action);
}

export const load: PageServerLoad = ({ url, cookies }) => {
	const groups = getWhatsNext({ whatsNext: whatsNextPort, clock });
	const filter = parseWhatsNextFilter(url.searchParams.get('filter'));
	return {
		filter,
		counts: countWhatsNextActions(groups),
		sections: projectWhatsNextSections(groups, filter),
		today: clock.todayIso(),
		undo: peekUndoFlash(cookies)
	};
};

async function transition(
	request: Request,
	cookies: Cookies,
	newState: 'DONE' | 'SKIPPED' | 'OPEN'
) {
	const formData = await request.formData();
	const parsed = parseTransitionFormData(formData, { requireItemId: true });
	if (!parsed) return fail(400, { error: t('items.detail.actionNotMutable') });

	const result = applyGuardedTransition(
		{ actions: actionsPort, history: itemHistoryPort, ids: idsPort, clock },
		{ itemId: parsed.itemId, actionId: parsed.actionId, newState },
		t('items.detail.actionNotMutable')
	);
	if (isTransitionFailure(result)) return result;

	if (newState === 'DONE') {
		writeUndoFlash(cookies, {
			itemId: parsed.itemId,
			actionId: parsed.actionId,
			label: truncateUndoLabel(result.label)
		});
	}

	redirectToFilteredRoot(request);
}

async function dueOverride(
	request: Request,
	eventType: 'ACTION_DUE_OVERRIDE_SET' | 'ACTION_DUE_OVERRIDE_CLEARED'
) {
	const formData = await request.formData();
	const parsed = parseDueOverrideFormData(formData, { requireItemId: true });
	if (!parsed) return fail(400, { error: t('items.detail.actionNotMutable') });

	const result = applyGuardedDueOverride(
		{ actions: actionsPort, history: itemHistoryPort, ids: idsPort, clock },
		{
			itemId: parsed.itemId,
			actionId: parsed.actionId,
			dueDate: eventType === 'ACTION_DUE_OVERRIDE_CLEARED' ? null : parsed.dueDate
		},
		eventType,
		t('items.detail.actionNotMutable'),
		() => currentDueOverrideEligibility(parsed.itemId, parsed.actionId)
	);
	if (isTransitionFailure(result)) return result;

	redirectToFilteredRoot(request);
}

/** Redirects back to the root URL, preserving the active filter (if any)
 *  — without this, the address bar would permanently carry the
 *  `?/completeAction`/`?/skipAction`/`?/reopenAction`/`?/undoAction`
 *  action-query suffix from this POST (no client-side `use:enhance` is
 *  used here, so forms keep working with JavaScript disabled). The
 *  filter is re-validated through `parseWhatsNextFilter` rather than
 *  echoed verbatim, so a garbage/crafted `filter` value never survives
 *  into the redirect target. */
function redirectToFilteredRoot(request: Request): never {
	const url = new URL(request.url);
	const filter = parseWhatsNextFilter(url.searchParams.get('filter'));
	redirect(303, filter === 'all' ? '/' : `/?filter=${filter}`);
}

export const actions: Actions = {
	completeAction: async ({ request, cookies }) => transition(request, cookies, 'DONE'),
	skipAction: async ({ request, cookies }) => transition(request, cookies, 'SKIPPED'),
	// Both root entry points reuse the guarded transition. The cookie is a
	// short-lived UI hint, not authorization; identity is checked at the write.
	reopenAction: async ({ request, cookies }) => transition(request, cookies, 'OPEN'),
	setActionDueOverride: async ({ request }) => dueOverride(request, 'ACTION_DUE_OVERRIDE_SET'),
	resetActionDueOverride: async ({ request }) =>
		dueOverride(request, 'ACTION_DUE_OVERRIDE_CLEARED'),
	undoAction: async ({ request, cookies }) => {
		const flash = peekUndoFlash(cookies);
		if (!flash) return fail(400, { error: t('whatsNext.undoExpired') });
		const submitted = parseTransitionFormData(await request.formData(), { requireItemId: true });
		if (!submitted || submitted.itemId !== flash.itemId || submitted.actionId !== flash.actionId) {
			// Another tab may have replaced the last-completion cookie. Never
			// reopen that newer action from an older, differently labelled notice.
			return fail(400, { error: t('whatsNext.undoExpired') });
		}
		consumeUndoFlash(cookies);
		// Cookies are client-controlled too. The same guarded write checks
		// ownership, active item/cycle and current state before reopening.
		const result = applyGuardedTransition(
			{ actions: actionsPort, history: itemHistoryPort, ids: idsPort, clock },
			{ itemId: flash.itemId, actionId: flash.actionId, newState: 'OPEN' },
			t('items.detail.actionNotMutable')
		);
		if (isTransitionFailure(result)) return result;
		redirectToFilteredRoot(request);
	}
};
