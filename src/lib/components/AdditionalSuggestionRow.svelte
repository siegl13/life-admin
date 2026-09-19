<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatCurrencyDisplay, formatDate } from '$lib/ui/format';
	import { parseCurrencyStorageValue, SUPPORTED_CURRENCY_CODES } from '$lib/domain/field/field';
	import type { AdditionalSuggestionForReview } from '$lib/application/ai/getExtractionRun';

	let { suggestion }: { suggestion: AdditionalSuggestionForReview } = $props();

	/* The type may be changed before adding (AI Extraction 1.1, section 6).
	   The derived value may be locally overridden, so the
	   value control (plain text / date / amount+code) needs to swap along
	   with it. Editing the type doesn't touch what was suggested — only
	   what gets submitted. */
	let type = $derived(suggestion.suggestedType);

	const suggestedCurrency = $derived(
		suggestion.suggestedType === 'currency' ? parseCurrencyStorageValue(suggestion.value) : null
	);

	function displaySuggestedValue(): string {
		if (suggestion.suggestedType === 'date') return formatDate(suggestion.value);
		if (suggestion.suggestedType === 'currency') return formatCurrencyDisplay(suggestion.value);
		return suggestion.value;
	}
</script>

<div class="field-row additional-suggestion">
	<label class="checkbox-row">
		<input type="checkbox" name="add:{suggestion.id}" value="yes" />
		<span class="additional-suggestion__suggested">
			{suggestion.suggestedLabel}
			<span class="meta">{displaySuggestedValue()}</span>
		</span>
	</label>

	<div class="field-row">
		<label for="additional-label-{suggestion.id}">{t('items.detail.customFieldLabel')}</label>
		<input
			id="additional-label-{suggestion.id}"
			name="label:{suggestion.id}"
			type="text"
			value={suggestion.suggestedLabel}
		/>
	</div>

	<div class="field-row">
		<label for="additional-type-{suggestion.id}">{t('items.detail.customFieldType')}</label>
		<select id="additional-type-{suggestion.id}" name="type:{suggestion.id}" bind:value={type}>
			<option value="text">{t('items.detail.fieldTypeText')}</option>
			<option value="date">{t('items.detail.fieldTypeDate')}</option>
			<option value="currency">{t('items.detail.fieldTypeCurrency')}</option>
		</select>
	</div>

	<div class="field-row">
		<label for="additional-value-{suggestion.id}">{t('items.detail.valueLabel')}</label>
		{#if type === 'date'}
			<input
				id="additional-value-{suggestion.id}"
				name="value:{suggestion.id}"
				type="date"
				value={suggestion.suggestedType === 'date' ? suggestion.value : ''}
			/>
		{:else if type === 'currency'}
			<div class="field-row__currency">
				<input
					id="additional-value-{suggestion.id}"
					name="value:{suggestion.id}"
					type="text"
					inputmode="decimal"
					placeholder="0,00"
					value={suggestedCurrency?.amount ?? ''}
				/>
				<select name="currency:{suggestion.id}" aria-label={t('items.detail.currencyCode')}>
					{#each SUPPORTED_CURRENCY_CODES as code (code)}
						<option value={code} selected={code === (suggestedCurrency?.currencyCode ?? 'EUR')}>
							{code}
						</option>
					{/each}
				</select>
			</div>
		{:else}
			<input
				id="additional-value-{suggestion.id}"
				name="value:{suggestion.id}"
				type="text"
				value={suggestion.suggestedType === 'text' ? suggestion.value : ''}
			/>
		{/if}
	</div>
</div>
