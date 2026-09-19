<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { formatDate } from '$lib/ui/format';
	import SuggestionRow from '$lib/components/SuggestionRow.svelte';
	import AdditionalSuggestionRow from '$lib/components/AdditionalSuggestionRow.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/* Client-side filter only — no full-text search infrastructure. Falls
	   back to showing the whole list when JavaScript is unavailable (the
	   input simply does nothing), same as every other progressive-
	   enhancement control in this app. */
	let additionalSearch = $state('');
	let filteredAdditional = $derived(
		data.additionalSuggestions.filter((s) =>
			`${s.suggestedLabel} ${s.value}`.toLowerCase().includes(additionalSearch.trim().toLowerCase())
		)
	);
</script>

<div class="page-head">
	<a class="backlink" href={resolve('/items/[id]', { id: data.itemId })}>← {data.itemTitle}</a>
	<h1>{t('ai.review.title')}</h1>
	<p>{t('ai.review.lead')}</p>
	<p class="hint">
		{data.attachmentFilename
			? t('ai.review.sourceDocument', { filename: data.attachmentFilename })
			: t('ai.review.sourceDocumentUnavailable')}
	</p>
	<p class="hint">
		{t('ai.review.createdAt', { date: formatDate(data.run.createdAt.slice(0, 10)) })}
	</p>
</div>

{#if form?.error}
	<div class="notice notice--error section" role="alert">
		<span class="notice__body">{form.error}</span>
	</div>
{/if}

{#if data.run.discardedCount > 0}
	<p class="hint">{t('ai.review.discarded', { count: String(data.run.discardedCount) })}</p>
{/if}

{#if data.suggestions.length === 0 && data.additionalSuggestions.length === 0}
	<p class="hint">{t('ai.review.nothingFound')}</p>
{/if}

{#if data.suggestions.length > 0 || data.additionalSuggestions.length > 0}
	<!-- One form for both sections: either button below submits everything
	     checked in both at once (accepted known-field suggestions AND
	     selected additional suggestions), rather than only whichever
	     section's own button was clicked — see the `apply` action. -->
	<form method="POST" action="?/apply">
		{#if data.suggestions.length > 0}
			<section class="section" aria-labelledby="known-suggestions-label" id="known-suggestions">
				<h2 class="section__label" id="known-suggestions-label">{t('ai.review.title')}</h2>
				<div class="form-panel">
					{#each data.suggestions as suggestion (suggestion.fieldKey)}
						<SuggestionRow {suggestion} />
					{/each}
					<div class="form-actions">
						<button type="submit">{t('ai.review.submit')}</button>
					</div>
				</div>
			</section>
		{/if}

		{#if data.additionalSuggestions.length > 0}
			<section
				class="section"
				aria-labelledby="additional-suggestions-label"
				id="additional-suggestions"
			>
				<h2 class="section__label" id="additional-suggestions-label">
					{t('ai.additional.title')}
				</h2>
				<div class="field-row">
					<label for="additional-search">{t('ai.additional.search')}</label>
					<input
						id="additional-search"
						type="search"
						bind:value={additionalSearch}
						placeholder={t('ai.additional.searchPlaceholder')}
					/>
				</div>

				<div class="form-panel">
					{#each filteredAdditional as suggestion (suggestion.id)}
						<AdditionalSuggestionRow {suggestion} />
					{/each}
					{#if filteredAdditional.length === 0}
						<p class="hint">{t('ai.additional.searchNoResults')}</p>
					{/if}
					<div class="form-actions">
						<button type="submit">{t('ai.additional.submit')}</button>
					</div>
				</div>
			</section>
		{/if}
	</form>
{/if}

{#if data.suggestions.length > 0}
	<form method="POST" action="?/dismiss">
		<button type="submit" class="secondary">{t('ai.review.dismiss')}</button>
	</form>
{/if}
