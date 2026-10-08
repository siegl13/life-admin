<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class="page-container page-container--list">
	<div class="page-head">
		<div class="page-head__row">
			<h1>{data.archived ? t('items.archived.title') : t('items.title')}</h1>
			<a
				class="button secondary items-archive-toggle"
				href={data.archived ? resolve('/items') : resolve('/items?archived=1')}
			>
				{data.archived ? t('items.archived.back') : t('items.archived.show')}
			</a>
		</div>
	</div>

	{#if data.items.length === 0}
		<div class="empty-state">
			{#if data.archived}
				<p>{t('items.archived.empty')}</p>
			{:else}
				<span class="empty-state__title">{t('items.emptyTitle')}</span>
				<p>{t('items.empty')}</p>
				<a class="button" href={resolve('/items/new')}>{t('items.new')}</a>
			{/if}
		</div>
	{:else}
		<div class="link-list items-list">
			{#each data.items as item (item.id)}
				<a class="link-list__row items-list__row" href={resolve('/items/[id]', { id: item.id })}>
					<span class="link-list__text">
						<span class="link-list__title">{item.title}</span>
					</span>
					<span
						class="pill items-list__playbook"
						class:pill--neutral={!item.playbookName}
						title={item.playbookName ?? t('items.new.noPlaybook')}
						>{item.playbookName ?? t('items.new.noPlaybook')}</span
					>
				</a>
			{/each}
		</div>
	{/if}
</div>
