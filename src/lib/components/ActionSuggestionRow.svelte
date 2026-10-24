<script lang="ts">
	import { t } from '$lib/i18n';
	import type { TranslationKey } from '$lib/i18n/de';
	import { formatDate } from '$lib/ui/format';
	import type { ActionSuggestionForReview } from '$lib/application/ai/getExtractionRun';

	let {
		suggestion,
		date,
		acceptAllDate,
		dateDependsOn
	}: {
		suggestion: ActionSuggestionForReview;
		date?: ActionSuggestionForReview['date'];
		acceptAllDate: ActionSuggestionForReview['date'];
		dateDependsOn: string[];
	} = $props();

	const UNIT_KEYS = {
		DAYS: ['ai.action.unitDaysOne', 'ai.action.unitDaysMany'],
		WEEKS: ['ai.action.unitWeeksOne', 'ai.action.unitWeeksMany'],
		MONTHS: ['ai.action.unitMonthsOne', 'ai.action.unitMonthsMany'],
		YEARS: ['ai.action.unitYearsOne', 'ai.action.unitYearsMany']
	} as const satisfies Record<string, readonly TranslationKey[]>;

	function relativeText(): string {
		const relative = suggestion.relative;
		if (!relative) return '';
		const [one, many] = UNIT_KEYS[relative.unit];
		return t(
			relative.relation === 'BEFORE' ? 'ai.action.relativeBefore' : 'ai.action.relativeAfter',
			{
				amount: String(relative.amount),
				unit: t(relative.amount === 1 ? one : many),
				anchor: relative.anchorLabel
			}
		);
	}

	/* Availability and estimates are shown as what they are, never as a
	   deadline: only DUE_BY / ON_DATE read as "due". */
	function dateText(resolved: ActionSuggestionForReview['date']): string {
		if (resolved.status === 'NONE') return t('ai.action.noDate');
		if (resolved.status === 'UNRESOLVED') {
			return suggestion.relative
				? t('ai.action.dateOpen', { relative: relativeText() })
				: t('ai.action.dateUnclear');
		}
		const formatted = formatDate(resolved.date);
		if (resolved.status === 'INFORMATIONAL') {
			return t(
				resolved.kind === 'AVAILABLE_FROM' ? 'ai.action.availableFrom' : 'ai.action.approximate',
				{ date: formatted }
			);
		}
		return t(resolved.kind === 'DUE_BY' ? 'ai.action.dueBy' : 'ai.action.onDate', {
			date: formatted
		});
	}
</script>

<div class="field-row action-suggestion" id="action-suggestion-{suggestion.id}">
	<!-- Unchecked on purpose: no Action is ever created without a selection. -->
	<label class="checkbox-row">
		<input type="checkbox" name="action:{suggestion.id}" value="yes" />
		<span>
			{suggestion.title}
			<span class="meta action-date--selected" data-action-date-selected>
				{t('ai.action.ifSelected')}: {dateText(date ?? suggestion.date)}
			</span>
		</span>
	</label>
	{#if dateDependsOn.length > 0}
		<p class="meta action-date--accept-all" data-action-date-accept-all>
			{t('ai.action.ifAcceptAll')}: {dateText(acceptAllDate)}
		</p>
	{/if}
	{#if dateDependsOn.length > 0}
		<noscript><p class="hint">{t('ai.action.noScriptDateNote')}</p></noscript>
	{/if}
	{#if suggestion.context}
		<p class="hint">{suggestion.context}</p>
	{/if}
	{#if suggestion.evidence}
		<p class="meta">{t('ai.action.evidence', { text: suggestion.evidence })}</p>
	{/if}
</div>
