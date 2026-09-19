<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { formatDue } from '$lib/ui/format';
	import type { WhatsNextAction } from '$lib/domain/whatsnext/whatsNext';

	let {
		action,
		itemId,
		prominent = false
	}: { action: WhatsNextAction; itemId: string; prominent?: boolean } = $props();

	let overdue = $derived(action.bucket === 0);
	let dueText = $derived(formatDue(action.bucket, action.dueDate));
</script>

<!--
	Always rendered inside an ItemGroup (see +page.svelte) — an ActionRow
	never appears on its own, which is what keeps every action tied to its
	item. The due text always spells the state out in words; colour only
	reinforces it.
-->
<div class="action-row" class:action-row--overdue={overdue}>
	<div class="action-row__text">
		<a class="action-row__label" href={resolve('/items/[id]', { id: itemId })}>{action.label}</a>
		<span class="action-row__due">{dueText}</span>
	</div>
	<form method="POST" action="?/completeAction" class="action-row__controls">
		<input type="hidden" name="actionId" value={action.actionId} />
		<input type="hidden" name="itemId" value={itemId} />
		<button type="submit" class={prominent ? '' : 'quiet'}>{t('whatsNext.done')}</button>
		<button type="submit" formaction="?/skipAction" class="secondary">
			{t('whatsNext.skip')}
		</button>
	</form>
</div>
