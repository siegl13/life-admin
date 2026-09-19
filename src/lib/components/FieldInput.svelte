<script lang="ts">
	import { t } from '$lib/i18n';
	import {
		parseCurrencyStorageValue,
		SUPPORTED_CURRENCY_CODES,
		type Field
	} from '$lib/domain/field/field';

	let { field, removable = false }: { field: Field; removable?: boolean } = $props();

	let currencyValue = $derived(
		field.type === 'currency' && field.value ? parseCurrencyStorageValue(field.value) : null
	);
</script>

<!--
	Renders any field purely from its metadata (type/recommended/origin).
	No branching on playbook id or field key here: this is what keeps the
	UI domain-agnostic, and why a CUSTOM field looks identical to a
	PLAYBOOK field except for the remove button.

	"empfohlen" is worded as a gentle suggestion and never rendered as a
	validation error — a recommended field stays optional.
-->
<div class="field-row" id="field-{field.fieldKey}" tabindex="-1">
	<div class="field-row__head">
		<label for={field.fieldKey}>
			{field.label}
			{#if field.recommended}
				<span class="field-row__optional">({t('items.detail.recommended')})</span>
			{/if}
		</label>
		{#if !removable}
			<span class="meta">{t('items.detail.fromPlaybook')}</span>
		{/if}
	</div>

	{#if field.type === 'date'}
		<input
			id={field.fieldKey}
			name="field:{field.fieldKey}"
			type="date"
			value={field.value ?? ''}
		/>
	{:else if field.type === 'currency'}
		<div class="field-row__currency">
			<input
				id={field.fieldKey}
				name="field:{field.fieldKey}"
				type="text"
				inputmode="decimal"
				placeholder="0,00"
				value={currencyValue?.amount ?? ''}
			/>
			<select name="fieldCurrency:{field.fieldKey}" aria-label={t('items.detail.currencyCode')}>
				{#each SUPPORTED_CURRENCY_CODES as code (code)}
					<option value={code} selected={code === (currencyValue?.currencyCode ?? 'EUR')}>
						{code}
					</option>
				{/each}
			</select>
		</div>
	{:else}
		<input
			id={field.fieldKey}
			name="field:{field.fieldKey}"
			type="text"
			value={field.value ?? ''}
		/>
	{/if}

	{#if field.recommended && !field.value}
		<span class="hint">{t('items.detail.recommendedHint')}</span>
	{/if}

	<!--
		Quiet, inline remove with a no-JS confirm step: the destructive
		action never fires from the first click. Matches the same
		disclosure-based confirm already used for the item archive action
		and the due-date reset (see ArchiveItemForm.svelte,
		WorkflowTimeline.svelte) — one convention for "destructive action
		needs a second step", not a new one just for this row.
	-->
	{#if removable}
		<details class="disclosure disclosure--quiet field-row__remove">
			<summary>{t('items.detail.removeField')}</summary>
			<div class="form-actions">
				<span class="hint">{t('items.detail.removeFieldConfirm')}</span>
				<button
					type="submit"
					class="danger"
					formaction="?/removeField"
					name="fieldKey"
					value={field.fieldKey}
				>
					{t('items.detail.removeField')}
				</button>
			</div>
		</details>
	{/if}
</div>
