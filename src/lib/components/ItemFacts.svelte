<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatCurrencyDisplay, formatDate } from '$lib/ui/format';
	import { formatEmptyFieldCount } from '$lib/ui/itemDetail';
	import type { Field } from '$lib/domain/field/field';
	import type { TranslationKey } from '$lib/i18n/de';

	let { fields, readOnly = false }: { fields: readonly Field[]; readOnly?: boolean } = $props();

	const groupOrder = ['date', 'currency', 'text'] as const;
	const groupLabel: Record<(typeof groupOrder)[number], TranslationKey> = {
		date: 'items.detail.factsGroupDate',
		currency: 'items.detail.factsGroupCurrency',
		text: 'items.detail.factsGroupText'
	};

	let groups = $derived(
		groupOrder
			.map((type) => ({
				type,
				label: groupLabel[type],
				fields: fields.filter((field) => field.type === type && Boolean(field.value))
			}))
			.filter((group) => group.fields.length > 0)
	);
	let emptyFields = $derived(fields.filter((field) => !field.value));

	function displayValue(field: Field): string {
		if (!field.value) return '';
		if (field.type === 'date') return formatDate(field.value);
		if (field.type === 'currency') return formatCurrencyDisplay(field.value);
		return field.value;
	}

	// An unbroken identifier (no ordinary spaces) stays one line with an
	// ellipsis, its full value only in `title`/accessible name. An ordinary
	// multiword value wraps instead, so it stays fully readable in place.
	function isUnbrokenValue(value: string): boolean {
		return value.length > 0 && !/\s/u.test(value);
	}
</script>

<div class="facts-view">
	{#if groups.length > 0}
		<div class="facts">
			{#each groups as group (group.type)}
				<section class="facts-group" aria-labelledby="facts-{group.type}">
					<h3 class="facts-group__label" id="facts-{group.type}">{t(group.label)}</h3>
					<div class="data-list">
						{#each group.fields as field (field.id)}
							<div class="data-row">
								<span class="data-row__key">{field.label}</span>
								<span
									class="data-row__value facts-group__value"
									class:facts-group__value--unbroken={isUnbrokenValue(displayValue(field))}
									title={displayValue(field)}
									aria-label={displayValue(field)}>{displayValue(field)}</span
								>
							</div>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{:else}
		<p class="hint">{t('items.detail.factsNoneYet')}</p>
	{/if}

	{#if emptyFields.length > 0}
		<details class="facts-empty" class:facts-empty--read-only={readOnly}>
			<summary>{formatEmptyFieldCount(emptyFields.length)}</summary>
			<div class="data-list">
				{#each emptyFields as field (field.id)}
					<div class="data-row data-row--empty">
						<span class="data-row__key">
							{field.label}
							{#if !readOnly && field.recommended}
								<span class="hint">
									<span aria-hidden="true">·</span>
									{t('items.detail.recommendedInlineHint')}
								</span>
							{/if}
						</span>
						{#if readOnly}
							<span class="data-row__value">{t('items.detail.fieldEmpty')}</span>
						{:else}
							<a href="#field-{field.fieldKey}">{t('items.detail.addValue')}</a>
						{/if}
					</div>
				{/each}
			</div>
		</details>
	{/if}
</div>
