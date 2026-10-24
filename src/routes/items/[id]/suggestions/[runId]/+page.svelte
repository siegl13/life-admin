<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { resolveActionDatesForSelection } from '$lib/application/ai/getExtractionRun';
	import { formatCurrencyDisplay, formatDate } from '$lib/ui/format';
	import SuggestionRow from '$lib/components/SuggestionRow.svelte';
	import ActionSuggestionRow from '$lib/components/ActionSuggestionRow.svelte';
	import AdditionalSuggestionRow from '$lib/components/AdditionalSuggestionRow.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let actionDates = $derived(data.actionDates);
	let acceptAllActionDates = $derived(
		resolveActionDatesForSelection(
			data.datePreviewFields,
			data.datePreviewSuggestions,
			data.actionSuggestions.map(({ id, sourceDate }) => ({ id, date: sourceDate })),
			{
				acceptedFieldKeys: data.suggestions
					.filter((suggestion) => suggestion.comparison === 'NEW')
					.map((suggestion) => suggestion.fieldKey)
			}
		)
	);
	function updateActionDates() {
		const reviewForm = document.querySelector('form[action="?/apply"]');
		if (!reviewForm) return;
		const acceptedFieldKeys = Array.from(
			reviewForm.querySelectorAll<HTMLInputElement>('input[name^="accept:"]:checked')
		).map((input) => input.name.slice('accept:'.length));
		const replaceFieldKeys = Array.from(
			reviewForm.querySelectorAll<HTMLInputElement>(
				'input[name^="resolve:"][value="replace"]:checked'
			)
		).map((input) => input.name.slice('resolve:'.length));
		actionDates = resolveActionDatesForSelection(
			data.datePreviewFields,
			data.datePreviewSuggestions,
			data.actionSuggestions.map(({ id, sourceDate }) => ({ id, date: sourceDate })),
			{ acceptedFieldKeys, replaceFieldKeys }
		);
	}

	let newSuggestions = $derived(data.suggestions.filter((s) => s.comparison === 'NEW'));
	let conflictingSuggestions = $derived(
		data.suggestions.filter((s) => s.comparison === 'CONFLICTING')
	);
	let hasDecisions = $derived(
		data.suggestions.length > 0 ||
			data.actionSuggestions.length > 0 ||
			data.additionalSuggestions.length > 0
	);
	let hasAnything = $derived(hasDecisions || data.alreadyPresent.length > 0);

	function displayValue(suggestion: { type: string; suggestedValue: string }): string {
		if (suggestion.type === 'date') return formatDate(suggestion.suggestedValue);
		if (suggestion.type === 'currency') return formatCurrencyDisplay(suggestion.suggestedValue);
		return suggestion.suggestedValue;
	}

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

{#if !hasAnything}
	<p class="hint">{t('ai.review.nothingFound')}</p>
{:else if !hasDecisions}
	<p class="hint">{t('ai.review.nothingNew')}</p>
{/if}

{#if hasAnything}
	<!-- One form for every section: either submit button below applies
	     everything selected in all of them at once (new details, explicit
	     conflict choices, selected tasks and additional details), rather
	     than only whichever section's own button was clicked — see the
	     `apply` action. -->
	<form method="POST" action="?/apply">
		{#if newSuggestions.length > 0}
			<section class="section" aria-labelledby="known-suggestions-label" id="known-suggestions">
				<h2 class="section__label" id="known-suggestions-label">{t('ai.review.newTitle')}</h2>
				<div class="form-panel">
					{#each newSuggestions as suggestion (suggestion.fieldKey)}
						<SuggestionRow {suggestion} onFieldChoiceChange={updateActionDates} />
					{/each}
				</div>
			</section>
		{/if}

		{#if conflictingSuggestions.length > 0}
			<section
				class="section"
				aria-labelledby="conflicting-suggestions-label"
				id="conflicting-suggestions"
			>
				<h2 class="section__label" id="conflicting-suggestions-label">
					{t('ai.review.conflictsTitle')}
				</h2>
				<p class="hint">{t('ai.review.conflictsLead')}</p>
				<div class="form-panel">
					{#each conflictingSuggestions as suggestion (suggestion.fieldKey)}
						<SuggestionRow {suggestion} onFieldChoiceChange={updateActionDates} />
					{/each}
				</div>
			</section>
		{/if}

		{#if data.actionSuggestions.length > 0}
			<section class="section" aria-labelledby="action-suggestions-label" id="action-suggestions">
				<h2 class="section__label" id="action-suggestions-label">{t('ai.action.title')}</h2>
				<p class="hint">{t('ai.action.lead')}</p>
				<div class="form-panel">
					{#each data.actionSuggestions as suggestion (suggestion.id)}
						<ActionSuggestionRow
							{suggestion}
							date={actionDates[suggestion.id] ?? suggestion.date}
							acceptAllDate={acceptAllActionDates[suggestion.id] ?? suggestion.date}
							dateDependsOn={data.dateDependencies[suggestion.id] ?? []}
						/>
					{/each}
				</div>
			</section>
		{/if}

		{#if hasDecisions}
			<div class="form-actions">
				<button type="submit">{t('ai.review.submit')}</button>
				{#if newSuggestions.length > 0}
					<button type="submit" class="secondary" name="intent" value="acceptAll">
						{t('ai.review.acceptAll')}
					</button>
				{/if}
			</div>
		{/if}

		{#if data.alreadyPresent.length > 0}
			<details class="section review-already-present" id="already-present">
				<summary>
					{t('ai.review.alreadyPresentTitle', { count: String(data.alreadyPresent.length) })}
				</summary>
				<p class="hint">{t('ai.review.alreadyPresentLead')}</p>
				<ul class="meta">
					{#each data.alreadyPresent as suggestion (suggestion.fieldKey)}
						<li>{suggestion.label}: {displayValue(suggestion)}</li>
					{/each}
				</ul>
			</details>
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

{#if hasAnything}
	<form method="POST" action="?/dismiss">
		<button type="submit" class="secondary">{t('ai.review.dismiss')}</button>
	</form>
{/if}
