<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { formatDate, formatRelativeDue } from '$lib/ui/format';
	import type { WhatsNextAction } from '$lib/domain/whatsnext/whatsNext';
	import type { WhatsNextFilter } from '$lib/ui/whatsNextView';

	let {
		action,
		itemId,
		itemTitle,
		today,
		filter
	}: {
		action: WhatsNextAction;
		itemId: string;
		itemTitle: string;
		today: string;
		filter: WhatsNextFilter;
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
		<summary aria-label={t('whatsNext.moreActions', { label: action.label })}>⋯</summary>
		<div class="action-menu__panel">
			<a href={resolve(`/items/[id]#action-${action.actionId}`, { id: itemId })}>
				{t('whatsNext.changeDueDate')}
			</a>
			<form method="POST" action={skipFormAction}>
				<input type="hidden" name="actionId" value={action.actionId} />
				<input type="hidden" name="itemId" value={itemId} />
				<button type="submit">{t('whatsNext.skip')}</button>
			</form>
		</div>
	</details>
</div>
