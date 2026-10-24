<script lang="ts">
	import UploadForm from '$lib/components/UploadForm.svelte';
	import { t } from '$lib/i18n';
</script>

<div class="upload-form-group">
	<UploadForm
		action="?/addAttachment"
		pickLabel={t('items.detail.attachmentFile')}
		submitLabel={t('items.detail.attachmentSubmit')}
		quiet
	/>
	<p class="hint">{t('items.detail.attachmentHint')}</p>
</div>
