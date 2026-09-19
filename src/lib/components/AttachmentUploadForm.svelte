<script lang="ts">
	import { t } from '$lib/i18n';
</script>

<form method="POST" action="?/addAttachment" enctype="multipart/form-data" class="form-panel">
	<label>{t('items.detail.attachmentFile')} <input name="file" type="file" required /></label>
	<p class="hint">{t('items.detail.attachmentHint')}</p>
	<button type="submit">{t('items.detail.attachmentSubmit')}</button>
</form>
