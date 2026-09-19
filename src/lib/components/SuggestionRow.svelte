<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatCurrencyDisplay, formatDate } from '$lib/ui/format';
	import type { SuggestionForReview } from '$lib/application/ai/getExtractionRun';

	let { suggestion }: { suggestion: SuggestionForReview } = $props();

	function display(value: string): string {
		if (suggestion.type === 'date') return formatDate(value);
		if (suggestion.type === 'currency') return formatCurrencyDisplay(value);
		return value;
	}

	/* An empty field is checked by default; a field that already has a
	   value is unchecked and gets an overwrite warning, so overwriting is
	   never the easy path (see the Slice 9 review flow). */
	const willOverwrite = $derived(
		suggestion.currentValue !== null && suggestion.currentValue !== ''
	);
</script>

<div class="field-row" id="suggestion-{suggestion.fieldKey}">
	<label class="checkbox-row">
		<input
			type="checkbox"
			name="accept:{suggestion.fieldKey}"
			value="yes"
			checked={!willOverwrite}
		/>
		{suggestion.label}
	</label>
	<p class="hint">
		{t('ai.review.currentValue')}:
		{suggestion.currentValue ? display(suggestion.currentValue) : t('ai.review.emptyValue')}
	</p>
	<p>{t('ai.review.suggestedValue')}: {display(suggestion.suggestedValue)}</p>
	{#if willOverwrite}
		<p class="hint">{t('ai.review.willOverwrite')}</p>
	{/if}
</div>
