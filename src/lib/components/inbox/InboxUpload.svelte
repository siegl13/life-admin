<script lang="ts">
	import UploadForm from '$lib/components/UploadForm.svelte';
	import { MAX_ATTACHMENT_BYTES } from '$lib/domain/attachment/attachment';
	import { t } from '$lib/i18n';

	let { compact = false }: { compact?: boolean } = $props();
	const maxMegabytes = MAX_ATTACHMENT_BYTES / 1024 / 1024;
</script>

<div class:upload-form-group={compact} class="inbox-upload">
	<UploadForm
		action="?/upload"
		pickLabel={t(compact ? 'inbox.upload.title' : 'inbox.empty.selectFile')}
		submitLabel={t('inbox.upload.submit')}
		accept="application/pdf,image/jpeg,image/png,image/webp"
		quiet={compact}
	/>
	<p class:inbox-upload__formats={compact} class:inbox-empty__formats={!compact}>
		{t('inbox.empty.formats', { max: String(maxMegabytes) })}
	</p>
</div>
