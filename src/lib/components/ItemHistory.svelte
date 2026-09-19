<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { formatDate } from '$lib/ui/format';
	import type { HistoryEventView } from '$lib/application/history/itemHistory';
	import type { CycleHistoryEntry } from '$lib/application/cycles/getCycleHistory';
	import type { HistoryEventType, HistoryEventPayload } from '$lib/domain/history/historyEvent';

	/** Mobile's initial visible count (see the roadmap's Mobile-behavior
	 *  section: "Desktop shows the last 10 events; mobile the last 5").
	 *  Matches the `639px` breakpoint already used in this component's CSS. */
	const MOBILE_INITIAL_COUNT = 5;

	let {
		events,
		total,
		limit,
		cycleHistory
	}: {
		events: HistoryEventView[];
		total: number;
		/** How many events the server already fetched, and the increment a
		 *  "show older" click grows that fetch by. */
		limit: number;
		cycleHistory: CycleHistoryEntry[];
	} = $props();

	let isMobile = $state(false);
	$effect(() => {
		if (typeof globalThis.matchMedia !== 'function') return;
		const query = globalThis.matchMedia('(max-width: 639px)');
		isMobile = query.matches;
		const onChange = (event: { matches: boolean }) => (isMobile = event.matches);
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	});

	let extraCount = $state(0);
	const initialCount = $derived(Math.min(events.length, isMobile ? MOBILE_INITIAL_COUNT : limit));
	const visibleCount = $derived(Math.min(events.length, initialCount + extraCount));

	const remaining = $derived(Math.max(0, total - visibleCount));

	type DateGroup = {
		label: string;
		events: HistoryEventView[];
	};

	function getDateGroupKey(dateStr: string): string {
		const date = new Date(dateStr);
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const yesterday = new Date(today.getTime() - 86400000);
		const eventDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

		if (eventDate.getTime() === today.getTime()) return 'today';
		if (eventDate.getTime() === yesterday.getTime()) return 'yesterday';
		if (eventDate.getMonth() === now.getMonth() && eventDate.getFullYear() === now.getFullYear())
			return 'thisMonth';
		const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
		if (
			eventDate.getMonth() === lastMonth.getMonth() &&
			eventDate.getFullYear() === lastMonth.getFullYear()
		)
			return 'lastMonth';
		if (eventDate.getFullYear() === now.getFullYear()) return 'thisYear';
		return `year:${eventDate.getFullYear()}`;
	}

	function getDateGroupLabel(key: string): string {
		if (key === 'today') return t('items.detail.historyToday');
		if (key === 'yesterday') return t('items.detail.historyYesterday');
		if (key === 'thisMonth') return t('items.detail.historyThisMonth');
		if (key === 'lastMonth') return t('items.detail.historyLastMonth');
		if (key === 'thisYear') return t('items.detail.historyThisYear');
		if (key.startsWith('year:')) return t('items.detail.historyYear', { year: key.slice(5) });
		return t('items.detail.historyOlder');
	}

	const groupedEvents = $derived.by(() => {
		const visible = events.slice(0, visibleCount);
		const groups: DateGroup[] = [];
		let currentGroup: DateGroup | null = null;

		for (const event of visible) {
			const key = getDateGroupKey(event.createdAt);
			if (!currentGroup || currentGroup.label !== getDateGroupLabel(key)) {
				currentGroup = { label: getDateGroupLabel(key), events: [] };
				groups.push(currentGroup);
			}
			currentGroup.events.push(event);
		}
		return groups;
	});

	function getEventText(
		eventType: HistoryEventType,
		payload: HistoryEventPayload,
		fieldLabel: string | null
	): string {
		const p = payload as Record<string, unknown>;
		switch (eventType) {
			case 'FIELD_CHANGED':
				return fieldLabel
					? t('items.detail.historyFieldChangedNamed', { label: fieldLabel })
					: t('items.detail.historyFieldChanged');
			case 'ATTACHMENT_ADDED':
				return t('items.detail.historyAttachmentAdded');
			case 'ATTACHMENT_REMOVED':
				return t('items.detail.historyAttachmentRemoved');
			case 'ACTION_COMPLETED':
				return t('items.detail.historyActionCompleted');
			case 'ACTION_SKIPPED':
				return t('items.detail.historyActionSkipped');
			case 'ACTION_ADDED':
				return t('items.detail.historyActionAdded');
			case 'ACTION_DUE_OVERRIDE_SET':
				return t('items.detail.historyActionDueOverrideSet');
			case 'ACTION_DUE_OVERRIDE_CLEARED':
				return t('items.detail.historyActionDueOverrideCleared');
			case 'CYCLE_STARTED':
				return t('items.detail.historyCycleStarted', {
					sequence: String(p.sequence ?? '')
				});
			case 'CYCLE_COMPLETED':
				return t('items.detail.historyCycleCompleted', {
					sequence: String(p.sequence ?? '')
				});
			case 'ITEM_ARCHIVED':
				return t('items.detail.historyItemArchived');
			case 'ITEM_UNARCHIVED':
				return t('items.detail.historyItemUnarchived');
			case 'RELATION_LINKED':
				return t('items.detail.historyRelationLinked');
			case 'RELATION_UNLINKED':
				return t('items.detail.historyRelationUnlinked');
			case 'AI_SUGGESTIONS_ACCEPTED':
				return t('items.detail.historyAiSuggestionsAccepted', {
					count: String(p.acceptedCount ?? 1)
				});
			case 'CUSTOM_FIELD_ADDED':
				return t('items.detail.historyCustomFieldAdded');
			case 'CUSTOM_FIELD_REMOVED':
				return t('items.detail.historyCustomFieldRemoved');
			default:
				return '';
		}
	}

	function formatTime(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}

	/** Grows the visible window by one page. When that exceeds what the
	 *  server already fetched (`events.length`), re-navigates with a wider
	 *  `historyCount` so `+page.server.ts`'s `load` fetches the rest —
	 *  purely widening `extraCount` here would just keep slicing the same
	 *  fixed fetch and never reveal anything beyond it. */
	function loadMore() {
		const nextVisible = Math.min(total, visibleCount + limit);
		extraCount = nextVisible - initialCount;
		if (nextVisible > events.length) {
			const itemId = page.params.id;
			if (!itemId) return;
			const target = resolve(`/items/[id]?historyCount=${nextVisible}#history-label`, {
				id: itemId
			});
			goto(target, { keepFocus: true, noScroll: true, replaceState: true });
		}
	}
</script>

{#if events.length > 0 || cycleHistory.length > 0}
	<section class="section" aria-labelledby="history-label">
		<h2 class="section__label" id="history-label">{t('items.detail.history')}</h2>

		{#if events.length === 0}
			<p class="hint">{t('items.detail.historyEmpty')}</p>
		{:else}
			<div class="history-timeline">
				{#each groupedEvents as group (group.label)}
					<div class="history-group">
						<h3 class="history-group__label">{group.label}</h3>
						{#each group.events as event (event.id)}
							<div class="history-event">
								<span class="history-event__time">{formatTime(event.createdAt)}</span>
								<span class="history-event__text"
									>{getEventText(event.eventType, event.payload, event.fieldLabel)}</span
								>
							</div>
						{/each}
					</div>
				{/each}
			</div>

			{#if remaining > 0}
				<div class="history-more">
					<button type="button" class="secondary" onclick={loadMore}>
						{t('items.detail.historyShowMore', { remaining: String(remaining) })}
					</button>
				</div>
			{/if}
		{/if}

		{#if cycleHistory.length > 0}
			<details class="history-cycles">
				<summary>{t('items.detail.historyCycleDetails')}</summary>
				{#each cycleHistory as entry (entry.cycle.id)}
					<details class="disclosure">
						<summary>
							{t('items.detail.historyCycle', {
								sequence: String(entry.cycle.sequence),
								date: entry.cycle.completedAt ? formatDate(entry.cycle.completedAt) : ''
							})}
						</summary>
						<div class="history-entry">
							{#each entry.fields as field (field.id)}
								<div class="history-entry__row">
									<span class="history-entry__label">{field.label}</span>
									<span class="history-entry__value">
										{field.value
											? field.type === 'date'
												? formatDate(field.value)
												: field.value
											: t('items.detail.historyEmptyValue')}
									</span>
								</div>
							{/each}
							{#each entry.actions as action (action.id)}
								<div class="history-entry__row">
									<span class="history-entry__label">{action.label}</span>
									<span class="history-entry__value">
										{action.state === 'DONE'
											? t('items.detail.status.done')
											: t('items.detail.status.skipped')}
										{#if action.completedAt}
											· {t('items.detail.historyCompletedOn', {
												date: formatDate(action.completedAt)
											})}
										{/if}
									</span>
								</div>
							{/each}
						</div>
					</details>
				{/each}
			</details>
		{/if}
	</section>
{/if}

<style>
	.history-timeline {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.history-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.history-group__label {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-muted, #666);
		margin: 0;
	}

	.history-event {
		display: flex;
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.25rem 0;
	}

	.history-event__time {
		font-size: 0.8125rem;
		color: var(--color-text-muted, #666);
		min-width: 3rem;
		flex-shrink: 0;
	}

	.history-event__text {
		font-size: 0.9375rem;
	}

	.history-more {
		margin-top: 1rem;
	}

	.history-cycles {
		margin-top: 1.5rem;
	}

	.history-cycles > summary {
		font-weight: 500;
		cursor: pointer;
		padding: 0.5rem 0;
	}

	.history-entry {
		padding: 0.5rem 0 0.5rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.history-entry__row {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-size: 0.875rem;
	}

	.history-entry__label {
		color: var(--color-text-muted, #666);
	}

	.history-entry__value {
		text-align: right;
	}

	@media (max-width: 639px) {
		.history-event {
			flex-direction: column;
			gap: 0.125rem;
		}

		.history-event__time {
			min-width: auto;
		}

		.history-entry__row {
			flex-direction: column;
			gap: 0.125rem;
		}

		.history-entry__value {
			text-align: left;
		}
	}
</style>
