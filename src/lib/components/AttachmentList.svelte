<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import type { TranslationKey } from '$lib/i18n/de';
	import type { Attachment, AttachmentMimeType } from '$lib/domain/attachment/attachment';
	import { attachmentDisplayName, formatByteSize } from '$lib/domain/attachment/attachment';
	import { formatDate } from '$lib/ui/format';

	/** Manage-mode content only (see items/[id]/+page.svelte). One outer
	 * form owns every display-name input, while each remove button uses its
	 * own formaction so no nested form is needed. */
	let {
		itemId,
		attachments,
		cycleSequences
	}: { itemId: string; attachments: Attachment[]; cycleSequences: Record<string, number> } =
		$props();

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

{#if attachments.length === 0}
	<p class="hint">{t('items.detail.attachmentsEmpty')}</p>
{:else}
	<form method="POST" action="?/manageAttachments" class="attachment-manage-form">
		<!-- Placed before the rows in DOM order (see .attachment-manage-form
		     CSS `order`) so it — not a row's "Entfernen" button — is the
		     form's default submit: pressing Enter in a display-name field
		     must save, never delete the attachment whose row happens to be
		     first. -->
		<div class="form-actions attachment-manage-footer">
			<button type="submit">{t('items.detail.saveDocumentNames')}</button>
			<span class="hint">{t('items.detail.attachmentStorageUntouched')}</span>
		</div>
		<div class="link-list">
			{#each attachments as attachment (attachment.id)}
				<div class="link-list__row attachment-manage-row" id={`attachment-manage-${attachment.id}`}>
					<span class="document-row__preview" aria-hidden="true">
						{#if attachment.mimeType === 'application/pdf'}
							<span class="document-row__type">PDF</span>
						{:else}
							<img src={contentUrl(attachment.id)} alt="" width="72" height="72" loading="lazy" />
						{/if}
					</span>
					<span class="link-list__text">
						<a
							class="link-list__title"
							href={resolve('/items/[id]/attachments/[attachmentId]', {
								id: itemId,
								attachmentId: attachment.id
							})}>{attachmentDisplayName(attachment)}</a
						>
						<span class="document-row__original">
							{t('items.detail.attachmentOriginalFilename')}: {attachment.filename}
						</span>
						<span class="meta">
							{t(TYPE_LABEL_KEY[attachment.mimeType])} · {formatByteSize(attachment.byteSize)} · {formatDate(
								attachment.uploadedAt.slice(0, 10)
							)}{#if attachment.cycleId && cycleSequences[attachment.cycleId]}
								· {t('items.detail.attachmentCycle', {
									sequence: String(cycleSequences[attachment.cycleId])
								})}{/if}
						</span>
						<input type="hidden" name="attachmentId" value={attachment.id} />
						<label class="attachment-name-field">
							<span>{t('items.detail.attachmentDisplayName')}</span>
							<input
								type="text"
								name={`displayName:${attachment.id}`}
								value={attachment.displayName ?? ''}
							/>
						</label>
					</span>
					<button
						type="submit"
						name="removeAttachmentId"
						value={attachment.id}
						formaction="?/removeAttachment"
						class="text-action--muted">{t('items.detail.removeAttachment')}</button
					>
				</div>
			{/each}
		</div>
	</form>
{/if}
