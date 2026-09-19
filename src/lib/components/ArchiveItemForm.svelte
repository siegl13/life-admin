<script lang="ts">
	import { t } from '$lib/i18n';
</script>

<details class="disclosure">
	<summary>{t('items.detail.archive')}</summary>
	<form method="POST" action="?/archiveItem" class="form-stack">
		<p class="hint">{t('items.detail.archiveHint')}</p>
		<p class="hint">{t('items.detail.archiveOpenWarning')}</p>
		<div class="form-actions">
			<button type="submit" class="quiet">{t('items.detail.archive')}</button>
		</div>
	</form>
</details>
