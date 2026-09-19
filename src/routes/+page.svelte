<script lang="ts">
	import ActionRow from '$lib/components/ActionRow.svelte';
	import ItemGroup from '$lib/components/ItemGroup.svelte';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/*
	 * Purely presentational regrouping: the ranking and grouping itself
	 * still comes from buildWhatsNext() untouched. Each item group is
	 * filed under the section of its most urgent action, so an item never
	 * appears twice and the order inside a section is the domain order.
	 */
	let sections = $derived(
		[
			{ key: 'overdue', bucket: 0, label: t('whatsNext.section.overdue') },
			{ key: 'now', bucket: 1, label: t('whatsNext.section.now') },
			{ key: 'later', bucket: 2, label: t('whatsNext.section.later') }
		].map((section) => ({
			...section,
			groups: data.groups.filter(
				(group) => Math.min(...group.actions.map((a) => a.bucket)) === section.bucket
			)
		}))
	);
</script>

<div class="page-head">
	<h1>{t('whatsNext.title')}</h1>
</div>

{#if data.groups.length === 0}
	<div class="empty-state">
		<span class="empty-state__title">{t('whatsNext.emptyTitle')}</span>
		<p>{t('whatsNext.empty')}</p>
		<a class="button" href={resolve('/items/new')}>{t('items.new')}</a>
	</div>
{:else}
	{#each sections as section (section.key)}
		{#if section.groups.length > 0}
			<section class="section" aria-labelledby="section-{section.key}">
				<h2
					class="section__label"
					class:section__label--overdue={section.bucket === 0}
					id="section-{section.key}"
				>
					{section.label}
				</h2>
				<div class="section__actions">
					{#each section.groups as group (group.itemId)}
						<ItemGroup itemId={group.itemId} title={group.title} overdue={section.bucket === 0}>
							{#each group.actions as action (action.actionId)}
								<ActionRow {action} itemId={group.itemId} prominent={section.bucket === 0} />
							{/each}
						</ItemGroup>
					{/each}
				</div>
			</section>
		{/if}
	{/each}
{/if}
