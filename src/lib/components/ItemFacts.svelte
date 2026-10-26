<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatCurrencyDisplay, formatDate } from '$lib/ui/format';
	import { formatEmptyFieldCount } from '$lib/ui/itemDetail';
	import type { Field } from '$lib/domain/field/field';
	import type { FieldGroupView } from '$lib/domain/field/fieldGroup';
	import GroupStarToggle from './GroupStarToggle.svelte';

	let { groups, readOnly = false }: { groups: readonly FieldGroupView[]; readOnly?: boolean } =
		$props();

	let filledGroups = $derived(groups.filter((view) => view.filledFields.length > 0));
	let emptyFields = $derived(groups.flatMap((view) => view.emptyFields));

	function groupLabel(view: FieldGroupView): string {
		return view.group.label ?? t('items.detail.groupGeneral');
	}

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
	{#if filledGroups.length > 0}
		<div class="facts">
			{#each filledGroups as view (view.group.id)}
				<section
					class="facts-group"
					class:facts-group--featured={view.group.featured}
					aria-labelledby="facts-{view.group.id}"
				>
					<div class="facts-group__head">
						<h3 class="facts-group__label" id="facts-{view.group.id}">
							{groupLabel(view)}
							{#if view.group.featured}
								<span class="pill pill--neutral facts-group__featured">
									{t('items.detail.groupFeatured')}
								</span>
							{/if}
						</h3>
						{#if !readOnly}
							<GroupStarToggle group={view.group} label={groupLabel(view)} returnTo="facts" />
						{/if}
					</div>
					<div class="data-list">
						{#each view.filledFields as field (field.id)}
							<div class="data-row" id="field-fact-{field.fieldKey}">
								<span class="data-row__key" id="fact-key-{field.id}">{field.label}</span>
								<span
									class="data-row__value facts-group__value"
									class:facts-group__value--unbroken={isUnbrokenValue(displayValue(field))}
									title={displayValue(field)}
									aria-label={displayValue(field)}>{displayValue(field)}</span
								>
								{#if field.sourceText}
									<p class="facts-group__source">
										<span class="facts-group__source-label">{t('items.detail.fieldSource')}:</span>
										<q>{field.sourceText}</q>
									</p>
								{/if}
								<div class="facts-group__confirmation">
									<span
										class="pill"
										class:pill--neutral={!field.confirmed}
										data-confirmed={field.confirmed}
									>
										{field.confirmed
											? t('items.detail.fieldConfirmed')
											: t('items.detail.fieldUnconfirmed')}
									</span>
									{#if !readOnly}
										<form method="POST" action="?/setFieldConfirmation">
											<input type="hidden" name="fieldKey" value={field.fieldKey} />
											<button
												type="submit"
												class="quiet"
												name="confirmed"
												value={field.confirmed ? 'no' : 'yes'}
												aria-describedby="fact-key-{field.id}"
											>
												{field.confirmed
													? t('items.detail.unconfirmField')
													: t('items.detail.confirmField')}
											</button>
										</form>
									{/if}
								</div>
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
