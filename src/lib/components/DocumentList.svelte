<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import type { TranslationKey } from '$lib/i18n/de';
	import {
		attachmentDisplayName,
		formatByteSize,
		type Attachment,
		type AttachmentMimeType
	} from '$lib/domain/attachment/attachment';
	import { formatDate } from '$lib/ui/format';

	let {
		itemId,
		attachments,
		cycleSequences
	}: {
		itemId: string;
		attachments: Attachment[];
		cycleSequences: Record<string, number>;
	} = $props();

	const TYPE_LABEL_KEY: Record<AttachmentMimeType, TranslationKey> = {
		'application/pdf': 'items.detail.attachmentTypePdf',
		'image/jpeg': 'items.detail.attachmentTypeJpeg',
		'image/png': 'items.detail.attachmentTypePng',
		'image/webp': 'items.detail.attachmentTypeWebp'
	};

	function contentUrl(attachmentId: string) {
		return `${resolve('/items/[id]/attachments/[attachmentId]', {
			id: itemId,
			attachmentId
		})}/content`;
	}
</script>

<div class="document-list">
	{#each attachments as attachment (attachment.id)}
		<div class="document-row" id={`attachment-${attachment.id}`}>
			<a
				class="document-row__preview"
				href={resolve('/items/[id]/attachments/[attachmentId]', {
					id: itemId,
					attachmentId: attachment.id
				})}
				tabindex="-1"
				aria-hidden="true"
			>
				{#if attachment.mimeType === 'application/pdf'}
					<span class="document-row__type">PDF</span>
				{:else}
					<img src={contentUrl(attachment.id)} alt="" width="72" height="72" loading="lazy" />
				{/if}
			</a>
			<span class="document-row__text">
				<a
					class="document-row__title"
					href={resolve('/items/[id]/attachments/[attachmentId]', {
						id: itemId,
						attachmentId: attachment.id
					})}
				>
					{attachmentDisplayName(attachment)}
				</a>
				<span class="document-row__original">
					{t('items.detail.attachmentOriginalFilename')}: {attachment.filename}
				</span>
				<span class="meta document-row__meta">
					{t(TYPE_LABEL_KEY[attachment.mimeType])} · {formatByteSize(attachment.byteSize)} · {formatDate(
						attachment.uploadedAt.slice(0, 10)
					)}{#if attachment.cycleId && cycleSequences[attachment.cycleId]}
						· {t('items.detail.attachmentCycle', {
							sequence: String(cycleSequences[attachment.cycleId])
						})}{/if}
				</span>
			</span>
			<a
				class="button quiet document-row__open"
				href={resolve('/items/[id]/attachments/[attachmentId]', {
					id: itemId,
					attachmentId: attachment.id
				})}
			>
				{t('items.detail.attachmentOpen')}
			</a>
		</div>
	{/each}
</div>
