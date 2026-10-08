<script lang="ts">
	import { MAX_ATTACHMENT_BYTES } from '$lib/domain/attachment/attachment';
	import { t } from '$lib/i18n';

	let { compact = false }: { compact?: boolean } = $props();
	const maxMegabytes = MAX_ATTACHMENT_BYTES / 1024 / 1024;
</script>

<div class:upload-form-group={compact} class="inbox-upload">
	<form method="POST" action="?/upload" enctype="multipart/form-data" class="upload-form">
		<label class="upload-picker button" class:quiet={compact}>
			{t(compact ? 'inbox.upload.title' : 'inbox.empty.selectFile')}
			<input
				type="file"
				name="file"
				accept="application/pdf,image/jpeg,image/png,image/webp"
				required
			/>
		</label>
		<button class="upload-form__submit" type="submit">{t('inbox.upload.submit')}</button>
	</form>
	<p class:inbox-upload__formats={compact} class:inbox-empty__formats={!compact}>
		{t('inbox.empty.formats', { max: String(maxMegabytes) })}
	</p>
</div>
