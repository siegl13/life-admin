<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatCurrencyDisplay, formatDate } from '$lib/ui/format';
	import type { SuggestionForReview } from '$lib/application/ai/getExtractionRun';

	let {
		suggestion,
		onFieldChoiceChange
	}: { suggestion: SuggestionForReview; onFieldChoiceChange?: () => void } = $props();

	function display(value: string): string {
		if (suggestion.type === 'date') return formatDate(value);
		if (suggestion.type === 'currency') return formatCurrencyDisplay(value);
		return value;
	}
</script>

<div class="field-row" id="suggestion-{suggestion.fieldKey}">
	{#if suggestion.comparison === 'CONFLICTING'}
		<!-- A different value is already stored. Keeping it is the default, so
		     submitting without touching this group never overwrites anything;
		     replacing needs the explicit second choice. -->
		<fieldset class="suggestion-conflict">
			<legend>
				{suggestion.label}
				<span class="pill pill--neutral">{t('ai.review.conflictBadge')}</span>
			</legend>
			<label class="checkbox-row">
				<input
					type="radio"
					name="resolve:{suggestion.fieldKey}"
					value="keep"
					checked
					onchange={onFieldChoiceChange}
				/>
				<span>
					{t('ai.review.keepCurrent')}
					<span class="meta">
						{t('ai.review.currentValue')}: {display(suggestion.currentValue ?? '')}
					</span>
				</span>
			</label>
			<label class="checkbox-row">
				<input
					type="radio"
					name="resolve:{suggestion.fieldKey}"
					value="replace"
					onchange={onFieldChoiceChange}
				/>
				<span>
					{t('ai.review.useDocument')}
					<span class="meta">
						{t('ai.review.documentValue')}: {display(suggestion.suggestedValue)}
					</span>
				</span>
			</label>
		</fieldset>
	{:else}
		<label class="checkbox-row">
			<input
				type="checkbox"
				name="accept:{suggestion.fieldKey}"
				value="yes"
				checked
				onchange={onFieldChoiceChange}
			/>
			<span>
				{suggestion.label}
				<span class="pill">{t('ai.review.newBadge')}</span>
			</span>
		</label>
		<p class="hint">
			{t('ai.review.currentValue')}: {t('ai.review.emptyValue')}
		</p>
		<p>{t('ai.review.suggestedValue')}: {display(suggestion.suggestedValue)}</p>
	{/if}
</div>
