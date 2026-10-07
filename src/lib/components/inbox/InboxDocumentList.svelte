<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { formatByteSize, type AttachmentMimeType } from '$lib/domain/attachment/attachment';
	import type { PageData } from '../../../routes/inbox/$types';

	type InboxDocument = PageData['documents'][number];

	let {
		documents,
		openDocumentId,
		typeAbbreviation,
		relativeTime,
		statusLabel
	}: {
		documents: InboxDocument[];
		openDocumentId: string | undefined;
		typeAbbreviation: (mimeType: AttachmentMimeType) => string;
		relativeTime: (value: string) => string;
		statusLabel: (document: InboxDocument) => string;
	} = $props();
</script>

<nav class="inbox-list" aria-label={t('inbox.list.label')}>
	<ul>
		{#each documents as document (document.id)}
			<li class="inbox-list__item">
				<a
					class="inbox-list__row"
					class:inbox-list__row--active={document.id === openDocumentId}
					href={resolve(`/inbox?doc=${encodeURIComponent(document.id)}`)}
					aria-current={document.id === openDocumentId ? 'true' : undefined}
					aria-label={t(
						document.id === openDocumentId ? 'inbox.openSelectedDocument' : 'inbox.openDocument',
						{ filename: document.filename }
					)}
				>
					<span class="file-tile" aria-hidden="true">{typeAbbreviation(document.mimeType)}</span>
					<span class="inbox-list__copy">
						<h3 class="inbox-list__name" title={document.filename}>{document.filename}</h3>
						<span class="meta inbox-list__meta">
							{formatByteSize(document.byteSize)} · {t('inbox.storedAt', {
								time: relativeTime(document.createdAt)
							})}
						</span>
						<span class="status-pill" class:status-pill--ready={Boolean(document.suggestion)}
							>{statusLabel(document)}</span
						>
					</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.inbox-list__item + .inbox-list__item {
		border-top: 1px solid var(--color-hairline);
	}

	.inbox-list__row {
		min-width: 0;
		display: grid;
		grid-template-columns: 34px minmax(0, 1fr);
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1.5px solid transparent;
		color: var(--color-text);
		text-decoration: none;
	}

	.inbox-list__row:hover {
		background: var(--color-surface-hover);
	}

	.inbox-list__row:focus-visible {
		position: relative;
		z-index: 1;
		outline: 2px solid var(--color-accent);
		outline-offset: -2px;
	}

	.inbox-list__row--active,
	.inbox-list__row--active:hover {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}

	.inbox-list__copy {
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
	}

	.inbox-list__name {
		width: 100%;
		min-width: 0;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-body);
		font-weight: 600;
	}

	.inbox-list__meta {
		margin: var(--space-1) 0 0;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		margin-top: var(--space-1);
		padding: 0.1rem 0.5rem;
		border: 1px solid transparent;
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text-muted);
		font-size: var(--text-meta);
		font-weight: 600;
	}

	.status-pill--ready {
		border-color: var(--color-accent-soft);
		color: var(--color-accent);
	}
</style>
