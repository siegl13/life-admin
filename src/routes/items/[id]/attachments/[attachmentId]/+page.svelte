<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import type { TranslationKey } from '$lib/i18n/de';
	import { formatByteSize, type AttachmentMimeType } from '$lib/domain/attachment/attachment';
	import { formatDate } from '$lib/ui/format';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const TYPE_LABEL_KEY: Record<AttachmentMimeType, TranslationKey> = {
		'application/pdf': 'items.detail.attachmentTypePdf',
		'image/jpeg': 'items.detail.attachmentTypeJpeg',
		'image/png': 'items.detail.attachmentTypePng',
		'image/webp': 'items.detail.attachmentTypeWebp'
	};
	let isArchived = $derived(data.item.status === 'ARCHIVED');
	let contentUrl = $derived(
		resolve('/items/[id]/attachments/[attachmentId]/content', {
			id: data.item.id,
			attachmentId: data.attachment.id
		})
	);
</script>

<div class="page-head document-viewer__head">
	<a class="backlink" href={resolve('/items/[id]', { id: data.item.id })}>
		← {t('items.detail.attachmentBackToItem', { item: data.item.title })}
	</a>
	<h1>{data.displayName}</h1>
	<p>{t('items.detail.attachmentOriginalFilename')}: {data.attachment.filename}</p>
	<p class="meta">
		{t(TYPE_LABEL_KEY[data.attachment.mimeType])} · {formatByteSize(data.attachment.byteSize)} · {formatDate(
			data.attachment.uploadedAt.slice(0, 10)
		)}{#if data.cycleSequence !== null}
			· {t('items.detail.attachmentCycle', {
				sequence: String(data.cycleSequence)
			})}{/if}
	</p>
</div>

{#if form?.error}
	<div class="notice notice--error section" role="alert">
		<span class="notice__title">{t('items.detail.saveFailed')}</span>
		<span class="notice__body">{form.error}</span>
	</div>
{/if}

<div class="document-viewer__actions section">
	<a
		class="button"
		href={resolve('/items/[id]/attachments/[attachmentId]/content?download=1', {
			id: data.item.id,
			attachmentId: data.attachment.id
		})}
		download>{t('items.detail.attachmentDownload')}</a
	>
	{#if data.aiExtractionAvailable && data.attachment.byteSize <= data.aiMaxDocumentBytes}
		<form method="POST" action="?/extract">
			<button type="submit" class="quiet">{t('items.detail.attachments.extract')}</button>
		</form>
	{/if}
</div>

<section class="section" aria-labelledby="document-preview-label">
	<h2 class="section__label" id="document-preview-label">{t('items.detail.attachmentPreview')}</h2>
	{#if data.attachment.mimeType === 'application/pdf'}
		<object
			class="document-viewer__pdf"
			data={contentUrl}
			type="application/pdf"
			title={t('items.detail.attachmentPreviewTitle', { name: data.displayName })}
		>
			<div class="notice">
				<span class="notice__body">{t('items.detail.attachmentPreviewFallback')}</span>
				<a
					href={resolve('/items/[id]/attachments/[attachmentId]/content?download=1', {
						id: data.item.id,
						attachmentId: data.attachment.id
					})}
					download>{t('items.detail.attachmentDownload')}</a
				>
			</div>
		</object>
	{:else if data.attachment.mimeType === 'image/jpeg' || data.attachment.mimeType === 'image/png' || data.attachment.mimeType === 'image/webp'}
		<div class="document-viewer__image">
			<img src={contentUrl} alt={data.displayName} width="1200" height="900" />
		</div>
	{:else}
		<div class="notice">
			<span class="notice__body">{t('items.detail.attachmentPreviewFallback')}</span>
		</div>
	{/if}
</section>

{#if !isArchived}
	<section class="section document-viewer__manage" aria-labelledby="document-manage-label">
		<h2 class="section__label" id="document-manage-label">{t('items.detail.manageAttachments')}</h2>
		<form method="POST" action="?/rename" class="form-panel">
			<label class="field-row">
				<span>{t('items.detail.attachmentDisplayName')}</span>
				<input type="text" name="displayName" value={data.attachment.displayName ?? ''} />
			</label>
			<button type="submit">{t('items.detail.saveDocumentNames')}</button>
		</form>
		<details class="disclosure disclosure--quiet">
			<summary>{t('items.detail.removeAttachment')}</summary>
			<form method="POST" action="?/remove" class="form-actions">
				<span class="hint">{t('items.detail.removeAttachmentConfirm')}</span>
				<button type="submit" class="danger">{t('items.detail.removeAttachment')}</button>
			</form>
		</details>
	</section>
{/if}
