<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { formatDate, formatRelativeDue } from '$lib/ui/format';
	import { canEditActionDueDate } from '$lib/ui/itemDetail';
	import type { WhatsNextActionView } from '$lib/application/whatsnext/getWhatsNext';
	import type { WhatsNextFilter } from '$lib/ui/whatsNextView';

	type DueOverrideFormResult = {
		error?: string;
		context?: 'dueOverride';
		actionId?: string;
		dueDate?: string | null;
	} | null;

	let {
		action,
		itemId,
		itemTitle,
		today,
		filter,
		form = null
	}: {
		action: WhatsNextActionView;
		itemId: string;
		itemTitle: string;
		today: string;
		filter: WhatsNextFilter;
		form?: DueOverrideFormResult;
	} = $props();

	let overdue = $derived(action.bucket === 0);
	let exactDueText = $derived(action.dueDate ? formatDate(action.dueDate) : t('due.noDate'));
	// Undated (bucket 1, "ready now") actions have no relative distance to
	// report — they get their own pill text instead, so every row shows a
	// pill, not just dated ones.
	let pillText = $derived(formatRelativeDue(action.dueDate, today) ?? t('due.relative.ready'));
	let pillClass = $derived(
		action.bucket === 0
			? 'due-pill--overdue'
			: action.bucket === 1
				? 'due-pill--now'
				: 'due-pill--later'
	);

	// Filter is navigation state, not a business field: it rides the form
	// `action` query (like the filter chips' own links), never a hidden
	// input. `?/completeAction` stays exactly that string when no filter is
	// active, so existing `form[action="?/completeAction"]` selectors keep
	// working.
	let completeFormAction = $derived(
		filter === 'all' ? '?/completeAction' : `?/completeAction&filter=${filter}`
	);
	let skipFormAction = $derived(
		filter === 'all' ? '?/skipAction' : `?/skipAction&filter=${filter}`
	);
	let setDueOverrideFormAction = $derived(
		filter === 'all' ? '?/setActionDueOverride' : `?/setActionDueOverride&filter=${filter}`
	);
	let resetDueOverrideFormAction = $derived(
		filter === 'all' ? '?/resetActionDueOverride' : `?/resetActionDueOverride&filter=${filter}`
	);

	// Mirrors canEditActionDueDate's eligibility rule (OPEN + DERIVED with a
	// resolved calculated or override date) — the same rule Item detail's
	// timeline uses, so an action that cannot be edited there cannot be
	// offered here either (manual, completed, skipped, or unresolved).
	let canEditDueDate = $derived(
		canEditActionDueDate({
			state: action.dueEditability.state,
			dueKind: action.dueEditability.dueKind,
			dueDate: action.dueEditability.suggestedDueDate,
			dueOverrideDate: action.dueEditability.dueOverrideDate
		})
	);
	let dueDialogId = $derived(`due-dialog-${action.actionId}`);
	let dueMenuButtonId = $derived(`action-menu-${action.actionId}`);

	/** The trigger stays a normal `<a>` to the Item detail action anchor, so
	 *  a no-JavaScript request still navigates there. With JavaScript, its
	 *  click is intercepted to open the dialog below instead — which starts
	 *  closed (no `open` attribute), unlike Item detail's SSR-open fallback,
	 *  since What's Next must never render a per-row dialog open without
	 *  JavaScript. */
	function openDueDialog(event: MouseEvent) {
		event.preventDefault();
		(event.currentTarget as HTMLElement).closest('details.action-menu')?.removeAttribute('open');
		(document.getElementById(dueDialogId) as HTMLDialogElement | null)?.showModal();
	}

	function closeDialog(event: MouseEvent) {
		(event.currentTarget as HTMLElement).closest('dialog')?.close();
	}

	/** Same "outside the padded box, not just outside the content" check
	 *  WorkflowTimeline's due/snooze dialogs already use. */
	function closeOnBackdropClick(event: MouseEvent) {
		const dialog = event.currentTarget as HTMLDialogElement;
		if (event.target !== dialog) return;
		const { left, right, top, bottom } = dialog.getBoundingClientRect();
		const outside =
			event.clientX < left ||
			event.clientX > right ||
			event.clientY < top ||
			event.clientY > bottom;
		if (outside) dialog.close();
	}

	function returnFocusToMenuButton() {
		(document.getElementById(dueMenuButtonId) as HTMLElement | null)?.focus();
	}

	/** A rejected due-override submission must reopen this row's own
	 *  dialog with the entered value and the error still visible. */
	$effect(() => {
		if (form?.context !== 'dueOverride' || form.actionId !== action.actionId) return;
		(document.getElementById(dueDialogId) as HTMLDialogElement | null)?.showModal();
	});
</script>

<!--
Always rendered inside a What's next item-context wrapper (see +page.svelte).
	The item name remains linked below the task title. Relative and exact due
	text both remain visible, so colour only reinforces the state.
-->
<div class="action-row" class:action-row--overdue={overdue}>
	<form method="POST" action={completeFormAction} class="action-row__done-form">
		<input type="hidden" name="actionId" value={action.actionId} />
		<input type="hidden" name="itemId" value={itemId} />
		<button
			type="submit"
			class="action-row__done"
			aria-label={t('whatsNext.doneLabel', { label: action.label })}
		>
			<svg class="action-row__done-ring" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
				<circle cx="22" cy="22" r="19" />
			</svg>
		</button>
	</form>
	<div class="action-row__text">
		<a class="action-row__label" href={resolve('/items/[id]', { id: itemId })}>{action.label}</a>
		<span class="action-row__due">
			<span class="due-pill {pillClass}">{pillText}</span>
			{exactDueText}
		</span>
		<a class="action-row__item" href={resolve('/items/[id]', { id: itemId })}>{itemTitle}</a>
	</div>
	<details class="action-menu">
		<summary id={dueMenuButtonId} aria-label={t('whatsNext.moreActions', { label: action.label })}
			>⋯</summary
		>
		<div class="action-menu__panel">
			{#if canEditDueDate}
				<a
					href={resolve(`/items/[id]#action-${action.actionId}`, { id: itemId })}
					onclick={openDueDialog}
				>
					{t('whatsNext.changeDueDate')}
				</a>
				{#if action.dueEditability.dueOverrideDate}
					<form method="POST" action={resetDueOverrideFormAction}>
						<input type="hidden" name="actionId" value={action.actionId} />
						<input type="hidden" name="itemId" value={itemId} />
						<button type="submit">{t('items.detail.resetDueOverride')}</button>
					</form>
				{/if}
			{/if}
			<form method="POST" action={skipFormAction}>
				<input type="hidden" name="actionId" value={action.actionId} />
				<input type="hidden" name="itemId" value={itemId} />
				<button type="submit">{t('whatsNext.skip')}</button>
			</form>
		</div>
	</details>
	{#if canEditDueDate}
		<dialog
			id={dueDialogId}
			class="action-dialog action-dialog--whats-next"
			aria-labelledby="due-dialog-title-{action.actionId}"
			onclick={closeOnBackdropClick}
			onclose={returnFocusToMenuButton}
		>
			<strong class="action-dialog__title" id="due-dialog-title-{action.actionId}">
				{t('whatsNext.changeDueDate')}
			</strong>
			<p class="meta">
				{t('items.detail.dueCurrentLabel')}
				{action.dueDate ? formatDate(action.dueDate) : t('due.noDate')}
			</p>
			{#if action.dueEditability.dueOverrideDate && action.dueEditability.dueOverrideDate !== action.dueEditability.suggestedDueDate}
				<p class="meta">
					{t('items.detail.dueSuggestedLabel')}
					{#if action.dueEditability.suggestedDueDate}
						{formatDate(action.dueEditability.suggestedDueDate)}
					{:else}
						{t('items.detail.dueOverrideSuggestionUnresolved')}
					{/if}
				</p>
			{/if}
			{#if form?.context === 'dueOverride' && form.actionId === action.actionId && form.error}
				<p class="notice notice--error" role="alert">{form.error}</p>
			{/if}
			<form method="POST" action={setDueOverrideFormAction} class="form-stack">
				<input type="hidden" name="actionId" value={action.actionId} />
				<input type="hidden" name="itemId" value={itemId} />
				<div class="field-row">
					<label for="due-date-{action.actionId}">{t('items.detail.dueDateLabel')}</label>
					{#if form?.context === 'dueOverride' && form.actionId === action.actionId && form.error}
						<!-- A native `type="date"` input sanitizes an invalid value back
						     to "" on parse, silently discarding what the user typed. A
						     rejected submission therefore reopens with a plain text
						     input instead, so the exact rejected text stays visible and
						     editable until a valid correction is submitted. -->
						<input
							id="due-date-{action.actionId}"
							name="dueDate"
							type="text"
							inputmode="numeric"
							placeholder="YYYY-MM-DD"
							value={form.dueDate ?? ''}
						/>
					{:else}
						<input
							id="due-date-{action.actionId}"
							name="dueDate"
							type="date"
							value={action.dueEditability.dueOverrideDate ??
								action.dueEditability.suggestedDueDate ??
								''}
						/>
					{/if}
				</div>
				<div class="form-actions">
					<button type="submit" class="quiet">{t('items.detail.saveDueDate')}</button>
					<button type="button" class="link" onclick={closeDialog}>
						{t('common.cancel')}
					</button>
				</div>
			</form>
		</dialog>
	{/if}
</div>
