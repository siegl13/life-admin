<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let input: { focus(): void };
	function initialQuery() {
		return data.query;
	}

	function initialData() {
		return data;
	}

	let query = $state(initialQuery());
	let loadedQuery = $state(initialQuery());
	let loadedData = $state(initialData());
	let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
	let loadingTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
	let loading = $state(false);
	let requestGeneration = 0;
	let normalizedQuery = $derived(
		Array.from(query.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()).slice(0, 120)
	);

	$effect(() => {
		if (data.query === loadedQuery) {
			query = data.query;
			loadedData = data;
		}
	});

	onMount(() => input.focus());

	function mark(value: string, range: { start: number; end: number } | null) {
		if (!range) return [{ value, marked: false }];
		const chars = Array.from(value);
		return [
			{ value: chars.slice(0, range.start).join(''), marked: false },
			{ value: chars.slice(range.start, range.end).join(''), marked: true },
			{ value: chars.slice(range.end).join(''), marked: false }
		];
	}

	function update(value: string) {
		const generation = ++requestGeneration;
		const nextQuery = Array.from(
			value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
		).slice(0, 120);
		loadedQuery = nextQuery.join('');
		globalThis.clearTimeout(timer);
		globalThis.clearTimeout(loadingTimer);
		loading = false;
		if (nextQuery.length < 2) {
			if (nextQuery.length === 0 && loadedData.query) {
				goto(resolve('/suche'), { keepFocus: true, noScroll: true });
			}
			return;
		}
		loadingTimer = globalThis.setTimeout(() => (loading = true), 500);
		timer = globalThis.setTimeout(() => {
			const destination = resolve(`/suche?q=${encodeURIComponent(loadedQuery)}`);
			goto(destination, { keepFocus: true, noScroll: true }).finally(() => {
				if (generation !== requestGeneration) return;
				globalThis.clearTimeout(loadingTimer);
				loading = false;
			});
		}, 250);
	}

	function reset() {
		requestGeneration++;
		globalThis.clearTimeout(timer);
		globalThis.clearTimeout(loadingTimer);
		loading = false;
		query = '';
		loadedQuery = '';
		goto(resolve('/suche'), { keepFocus: true, noScroll: true }).then(() => input.focus());
	}
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && query && reset()} />

<section class="search-page">
	<h1>{t('search.title')}</h1>
	<form method="GET" action={resolve('/suche')}>
		<label class="visually-hidden" for="search-query">{t('search.label')}</label>
		<input
			bind:this={input}
			id="search-query"
			name="q"
			type="search"
			bind:value={query}
			oninput={(event) => update(event.currentTarget.value)}
			placeholder={t('search.placeholder')}
			enterkeyhint="search"
		/>
		{#if query}<button
				type="button"
				class="search-reset"
				aria-label={t('search.reset')}
				onclick={reset}><span aria-hidden="true">×</span></button
			>{/if}
	</form>
	<p class="search-status" aria-live="polite">
		{#if normalizedQuery.length === 0}{t('search.emptyStatus')}
		{:else if normalizedQuery.length < 2}{t('search.shortStatus')}
		{:else if loading}{t('search.loading')}
		{:else if loadedData.total === 0}{t('search.none')}
		{:else if loadedData.total > 20}{t('search.cappedStatus', { count: String(loadedData.total) })}
		{:else if loadedData.total === 1}{t('search.one')}
		{:else}{t('search.many', { count: String(loadedData.total) })}{/if}
	</p>
	{#if !loadedData.query}
		<div class="empty-state">
			<span class="empty-state__title">{t('search.emptyTitle')}</span>
			<p>{t('search.emptyBody')}</p>
		</div>
	{:else if loadedData.query && loadedData.total === 0}
		<div class="empty-state">
			<span class="empty-state__title">{t('search.noneTitle', { query: loadedData.query })}</span>
			<p>{t('search.noneBody')}</p>
		</div>
	{:else if loadedData.results.length > 0}
		<ul class="search-results">
			{#each loadedData.results as result (result.itemId)}
				<li>
					<a href={resolve('/items/[id]', { id: result.itemId })}>
						<span class="search-result__copy"
							><strong
								>{#each mark(result.title, result.highlight?.target === 'title' ? result.highlight : null) as part, index (index)}{#if part.marked}<mark
											>{part.value}</mark
										>{:else}{part.value}{/if}{/each}</strong
							>
							<span class="meta"
								>{#each mark(result.typeLabel, result.highlight?.target === 'type' ? result.highlight : null) as part, index (index)}{#if part.marked}<mark
											>{part.value}</mark
										>{:else}{part.value}{/if}{/each}</span
							>
							{#if result.contextValue}<span class="search-result__context"
									>{result.contextLabel}: {#each mark(result.contextValue, result.highlight?.target === 'context' ? result.highlight : null) as part, index (index)}{#if part.marked}<mark
												>{part.value}</mark
											>{:else}{part.value}{/if}{/each}</span
								>{/if}
							{#if result.moreMatches === 1}<span class="hint">{t('search.oneMore')}</span
								>{:else if result.moreMatches > 1}<span class="hint"
									>{t('search.more', { count: String(result.moreMatches) })}</span
								>{/if}
						</span><span aria-hidden="true">›</span></a
					>
				</li>
			{/each}
		</ul>
		{#if loadedData.total > 20}<p class="hint">{t('search.cappedHint')}</p>{/if}
	{/if}
</section>
