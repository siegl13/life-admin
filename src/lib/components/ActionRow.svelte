<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { formatDue, formatRelativeDue } from '$lib/ui/format';
	import type { WhatsNextAction } from '$lib/domain/whatsnext/whatsNext';
	import type { WhatsNextFilter } from '$lib/ui/whatsNextView';

	let {
		action,
		itemId,
		today,
		filter
	}: { action: WhatsNextAction; itemId: string; today: string; filter: WhatsNextFilter } = $props();

	let overdue = $derived(action.bucket === 0);
	let dueText = $derived(formatDue(action.bucket, action.dueDate));
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
	Always rendered inside an ItemGroup (see +page.svelte) — an ActionRow
	never appears on its own, which is what keeps every action tied to its
	item. The due text always spells the state out in words; colour only
	reinforces it.
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
			{dueText}
		</span>
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
