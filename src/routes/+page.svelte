<script lang="ts">
	import ActionRow from '$lib/components/ActionRow.svelte';
	import ItemGroup from '$lib/components/ItemGroup.svelte';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import type { TranslationKey } from '$lib/i18n/de';
	import type { WhatsNextFilter } from '$lib/ui/whatsNextView';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const SECTION_LABEL: Record<0 | 1 | 2, string> = {
		0: t('whatsNext.section.overdue'),
		1: t('whatsNext.section.now'),
		2: t('whatsNext.section.later')
	};

	const SECTION_CLASS: Record<0 | 1 | 2, string> = {
		0: 'section__label--overdue',
		1: 'section__label--now',
		2: 'section__label--later'
	};

	const FILTERS: { value: WhatsNextFilter; labelKey: TranslationKey }[] = [
		{ value: 'all', labelKey: 'whatsNext.filterAll' },
		{ value: 'overdue', labelKey: 'whatsNext.filterOverdue' },
		{ value: 'now', labelKey: 'whatsNext.filterNow' },
		{ value: 'later', labelKey: 'whatsNext.filterLater' }
	];

	let hasAnyActions = $derived(data.counts.all > 0);
	let hasVisibleActions = $derived(data.sections.some((section) => section.groups.length > 0));
	let undoFormAction = $derived(
		data.filter === 'all' ? '?/undoAction' : `?/undoAction&filter=${data.filter}`
	);
</script>

<div class="page-head">
	<h1>{t('whatsNext.title')}</h1>
</div>

{#if form?.error}
	<p class="form-error" role="alert">{form.error}</p>
{/if}

{#if data.undo}
	<form method="POST" action={undoFormAction} class="undo-notice" role="status">
		<input type="hidden" name="itemId" value={data.undo.itemId} />
		<input type="hidden" name="actionId" value={data.undo.actionId} />
		<p>{t('whatsNext.undoNotice', { label: data.undo.label })}</p>
		<button type="submit" class="link undo-notice__button">{t('whatsNext.undo')}</button>
	</form>
{/if}

<nav class="filter-bar" aria-label={t('whatsNext.title')}>
	{#each FILTERS as filterOption (filterOption.value)}
		<a
			href={filterOption.value === 'all' ? resolve('/') : resolve(`/?filter=${filterOption.value}`)}
			class="filter-chip"
			aria-current={data.filter === filterOption.value ? 'page' : undefined}
		>
			{t(filterOption.labelKey, { count: String(data.counts[filterOption.value]) })}
		</a>
	{/each}
</nav>

{#if !hasAnyActions}
	<div class="empty-state">
		<span class="empty-state__title">{t('whatsNext.emptyTitle')}</span>
		<p>{t('whatsNext.empty')}</p>
		<a class="button" href={resolve('/items/new')}>{t('items.new')}</a>
	</div>
{:else}
	{#if !hasVisibleActions}
		<p class="empty-state__title">{t('whatsNext.emptyFiltered')}</p>
	{:else}
		<!-- An item can appear in several bucket sections. Each action appears
		     exactly once, always with its item context and original domain order. -->
		{#each data.sections as section (section.bucket)}
			{#if section.groups.length > 0}
				<section class="section" aria-labelledby="section-{section.bucket}">
					<h2
						class="section__label section__label--plain {SECTION_CLASS[section.bucket]}"
						id="section-{section.bucket}"
					>
						<span>{SECTION_LABEL[section.bucket]}</span>
						<span class="section__label__count">
							{t('whatsNext.sectionCount', {
								count: String(section.groups.reduce((n, g) => n + g.actions.length, 0))
							})}
						</span>
					</h2>
					<div class="section__actions">
						{#each section.groups as group (group.itemId)}
							<ItemGroup itemId={group.itemId} title={group.title} overdue={section.bucket === 0}>
								{#each group.actions as action (action.actionId)}
									<ActionRow
										{action}
										itemId={group.itemId}
										today={data.today}
										filter={data.filter}
									/>
								{/each}
							</ItemGroup>
						{/each}
					</div>
				</section>
			{/if}
		{/each}
	{/if}
{/if}
