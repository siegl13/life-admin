<script lang="ts">
	import { t } from '$lib/i18n';

	let { canStartNextCycle }: { canStartNextCycle: boolean } = $props();
</script>

<section class="section" aria-labelledby="completion-label">
	<div class="surface next-up">
		<div class="next-up__text">
			<span class="next-up__label" id="completion-label">{t('items.detail.completion')}</span>
			<span class="hint">{t('items.detail.completionLead')}</span>
		</div>
		<form method="POST" class="form-actions">
			{#if canStartNextCycle}
				<button type="submit" formaction="?/startNextCycle">
					{t('items.detail.startNextCycle')}
				</button>
			{/if}
			<button type="submit" formaction="?/archiveItem" class="secondary">
				{t('items.detail.archive')}
			</button>
		</form>
	</div>
</section>
