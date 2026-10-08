<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { AttachmentMimeType } from '$lib/domain/attachment/attachment';
	import { formatDate, formatRelativeTime } from '$lib/ui/format';
	import { t } from '$lib/i18n';
	import InboxDocumentList from '$lib/components/inbox/InboxDocumentList.svelte';
	import InboxRouteForm from '$lib/components/inbox/InboxRouteForm.svelte';
	import InboxUpload from '$lib/components/inbox/InboxUpload.svelte';
	import type { ActionData, PageData } from './$types';

	type InboxDocument = PageData['documents'][number];

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let openDocumentId = $derived.by(() => {
		const requestedId = page.url.searchParams.get('doc');
		return (
			data.documents.find((document) => document.id === requestedId)?.id ?? data.documents[0]?.id
		);
	});
	let listFirst = $derived(page.url.searchParams.get('view') === 'list');

	function relativeTime(value: string): string {
		return formatRelativeTime(value, data.now);
	}

	function uploadDate(value: string): string {
		return formatDate(value.slice(0, 10));
	}

	function typeAbbreviation(mimeType: AttachmentMimeType): string {
		if (mimeType === 'application/pdf') return 'PDF';
		if (mimeType === 'image/jpeg') return 'JPG';
		if (mimeType === 'image/png') return 'PNG';
		return 'WEBP';
	}

	function statusLabel(document: InboxDocument): string {
		return document.suggestion ? t('inbox.suggestion.badge') : t('inbox.status.notAnalyzed');
	}
</script>

<div class="inbox-page page-container page-container--wide">
	<div class="inbox-page-head">
		<div class="page-head inbox-page-head__copy">
			<h1>{t('inbox.title')}</h1>
			<p>{t('inbox.lead')}</p>
			{#if data.documents.length > 0}
				<p class="inbox-count">
					{t(data.documents.length === 1 ? 'inbox.countOne' : 'inbox.countMany', {
						count: String(data.documents.length)
					})}
				</p>
			{/if}
		</div>
		{#if data.documents.length > 0}
			<InboxUpload compact />
		{/if}
	</div>

	{#if form?.error}<div class="notice notice--error section" role="alert">{form.error}</div>{/if}

	{#if data.documents.length === 0}
		<section class="inbox-empty" aria-labelledby="inbox-empty-title">
			<h2 id="inbox-empty-title">{t('inbox.empty.title')}</h2>
			<p>{t('inbox.empty.body')}</p>
			<InboxUpload />
		</section>
	{:else}
		<div class="inbox-layout" class:inbox-layout--list-first={listFirst}>
			<InboxDocumentList
				documents={data.documents}
				{openDocumentId}
				{typeAbbreviation}
				{relativeTime}
				{statusLabel}
			/>

			{#each data.documents as document (document.id)}
				{#if document.id === openDocumentId}
					<article class="inbox-detail" aria-labelledby={`document-${document.id}`}>
						<a
							class="inbox-back-link"
							href={resolve(`/inbox?doc=${encodeURIComponent(document.id)}&view=list`)}
							>{t('inbox.backToList')}</a
						>
						<InboxRouteForm {document} {data} {typeAbbreviation} {uploadDate} {relativeTime} />
					</article>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.inbox-page-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-5);
		margin-bottom: var(--space-7);
	}

	.inbox-page-head__copy {
		margin-bottom: 0;
	}

	.inbox-empty {
		background: var(--color-surface);
		border: 1px dashed var(--color-border-strong);
		border-radius: var(--radius-lg);
		padding: var(--space-8) var(--space-5);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		text-align: center;
	}

	.inbox-empty h2,
	.inbox-empty p {
		margin: 0;
	}

	.inbox-empty h2 {
		font-size: var(--text-section);
	}

	.inbox-empty p {
		max-width: 42rem;
		color: var(--color-text-muted);
		font-size: var(--text-body);
		text-wrap: pretty;
	}

	@media (max-width: 640px) {
		.inbox-page-head {
			align-items: stretch;
			flex-direction: column;
			gap: var(--space-4);
		}

		.inbox-empty {
			padding: var(--space-7) var(--space-4);
		}

		.inbox-detail {
			padding: var(--space-4);
		}
	}
</style>
