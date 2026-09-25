<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { formatDate } from '$lib/ui/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const rangeLabels = {
		thisWeek: 'upcoming.thisWeek',
		next30Days: 'upcoming.next30Days',
		later: 'upcoming.later'
	} as const;

	const stateLabels = {
		available: 'upcoming.available',
		blocked: 'upcoming.blocked'
	} as const;
</script>

<div class="page-head">
	<h1>{t('upcoming.title')}</h1>
	<p>{t('upcoming.lead')}</p>
</div>

<div class="upcoming-ranges">
	{#each data.ranges as range (range.key)}
		<details class="upcoming-range" open={range.actions.length > 0}>
			<summary>
				<span>{t(rangeLabels[range.key])}</span>
				<span class="upcoming-range__count">{range.actions.length}</span>
			</summary>
			{#if range.actions.length > 0}
				<ul class="upcoming-list">
					{#each range.actions as action (action.actionId)}
						<li class:upcoming-row--blocked={!action.available} class="upcoming-row">
							<a href={resolve('/items/[id]', { id: action.itemId })} class="upcoming-row__copy">
								<strong>{action.label}</strong>
								<span>{action.itemTitle}</span>
							</a>
							<div class="upcoming-row__meta">
								<time datetime={action.dueDate}>{formatDate(action.dueDate)}</time>
								<span class="upcoming-row__state">
									{t(action.available ? stateLabels.available : stateLabels.blocked)}
								</span>
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="upcoming-range__empty">{t('upcoming.empty')}</p>
			{/if}
		</details>
	{/each}
</div>
