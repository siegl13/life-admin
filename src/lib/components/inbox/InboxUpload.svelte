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

<style>
	.inbox-upload {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
	}

	.upload-form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
	}

	.upload-picker {
		position: relative;
		min-height: var(--control-h);
		overflow: hidden;
	}

	.upload-form-group .upload-picker {
		padding: var(--space-3) var(--space-6);
		border-width: 2px;
		border-style: dashed;
	}

	.upload-picker input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	.upload-picker:focus-within {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.upload-form__submit {
		min-height: var(--control-h);
	}

	.upload-form:has(input:invalid) .upload-form__submit {
		display: none;
	}

	.inbox-upload__formats,
	.inbox-empty__formats {
		margin: 0;
		color: var(--color-text-faint);
		font-size: var(--text-meta);
	}

	:global(.inbox-empty) .inbox-upload {
		margin-top: var(--space-3);
	}

	@media (max-width: 640px) {
		.upload-form-group,
		.upload-form-group .upload-form {
			align-items: flex-start;
			justify-content: flex-start;
		}
	}
</style>
