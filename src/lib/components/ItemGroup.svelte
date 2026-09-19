<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';

	let {
		itemId,
		title,
		playbookName = null,
		overdue = false,
		children
	}: {
		itemId: string;
		title: string;
		playbookName?: string | null;
		overdue?: boolean;
		children: Snippet;
	} = $props();
</script>

<!--
	The item is the group, always: an ActionRow is only ever rendered as a
	child of this component, so no action can appear without its item
	context ("No orphan tasks"). The overdue flag adds a thin left rule —
	deliberately not a filled red panel.
-->
<article class="item-group" class:item-group--overdue={overdue}>
	<p class="item-group__context">
		<a href={resolve('/items/[id]', { id: itemId })}>{title}</a>
		{#if playbookName}
			<span class="item-group__playbook"> · {playbookName}</span>
		{/if}
	</p>
	{@render children()}
</article>
