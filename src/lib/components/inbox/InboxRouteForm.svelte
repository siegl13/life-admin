<script lang="ts">
	import { formatByteSize, type AttachmentMimeType } from '$lib/domain/attachment/attachment';
	import { resolveLabel, t } from '$lib/i18n';
	import type { PageData } from '../../../routes/inbox/$types';

	type InboxDocument = PageData['documents'][number];

	let {
		document,
		data,
		typeAbbreviation,
		uploadDate,
		relativeTime
	}: {
		document: InboxDocument;
		data: PageData;
		typeAbbreviation: (mimeType: AttachmentMimeType) => string;
		uploadDate: (value: string) => string;
		relativeTime: (value: string) => string;
	} = $props();

	function defaultTitle(filename: string): string {
		return filename.replace(/\.[^.]+$/, '').trim() || filename;
	}

	function suggestedItemId(): string | null {
		return (
			data.items.find((item) => document.suggestion?.suggestedItemIds.includes(item.id))?.id ?? null
		);
	}

	function suggestedPlaybookId(): string | null {
		return (
			data.playbooks.find((playbook) => playbook.id === document.suggestion?.suggestedPlaybookId)
				?.id ?? null
		);
	}

	function suggestedTarget(): string | null {
		const item = data.items.find((candidate) => candidate.id === suggestedItemId());
		if (item) return item.title;
		const playbook = data.playbooks.find((candidate) => candidate.id === suggestedPlaybookId());
		return playbook ? resolveLabel(playbook.name, playbook.labelI18n) : null;
	}

	function defaultDestination(): 'existing' | 'new' {
		if (suggestedItemId()) return 'existing';
		if (suggestedPlaybookId()) return 'new';
		return data.items.length > 0 ? 'existing' : 'new';
	}
</script>

<form method="POST" action="?/route" class="route-form">
	<input type="hidden" name="documentId" value={document.id} />

	<header class="document-head">
		<div class="file-tile" aria-hidden="true">{typeAbbreviation(document.mimeType)}</div>
		<div class="document-head__copy">
			<h2 id={`document-${document.id}`} title={document.filename}>{document.filename}</h2>
			<p class="meta">
				{typeAbbreviation(document.mimeType)} · {formatByteSize(document.byteSize)} · {t(
					'inbox.storedAt',
					{ time: uploadDate(document.createdAt) }
				)}
			</p>
		</div>
		{#if data.aiAvailable}
			<button class="text-action analyze-action" type="submit" formaction="?/analyze" formnovalidate
				>{t('inbox.analyze')}</button
			>
		{/if}
	</header>

	{#if document.suggestion}
		<section class="suggestion" aria-labelledby={`suggestion-${document.id}`}>
			<div class="suggestion__head">
				<h3 id={`suggestion-${document.id}`}>{t('inbox.suggestion.label')}</h3>
				<span class="suggestion__time"
					>{t('inbox.suggestion.createdAt', {
						time: relativeTime(document.updatedAt)
					})}</span
				>
			</div>
			<p>
				{#if document.suggestion.documentKind}{t('inbox.suggestion.kind', {
						kind: document.suggestion.documentKind
					})}{/if}
				{#if suggestedTarget()}
					{t('inbox.suggestion.target', { target: suggestedTarget() ?? '' })}{/if}
				{#if !document.suggestion.documentKind && !suggestedTarget()}{t(
						'inbox.suggestion.generic'
					)}{/if}
			</p>
			<p class="suggestion__hint">{t('inbox.suggestion.hint')}</p>
		</section>
	{/if}

	<fieldset class="route-choices">
		<legend>{t('inbox.destination.legend')}</legend>

		<div class="route-option">
			<div class="route-option__choice">
				<input
					id={`destination-existing-${document.id}`}
					type="radio"
					name="destination"
					value="existing"
					checked={defaultDestination() === 'existing'}
				/>
				{#if suggestedItemId()}
					<label for={`destination-existing-${document.id}`}>
						<span class="route-option__label-text">{t('inbox.existingItem')}</span>
						<span class="suggested-badge" aria-hidden="true">{t('inbox.suggestion.badge')}</span>
					</label>
				{:else}
					<label for={`destination-existing-${document.id}`}>{t('inbox.existingItem')}</label>
				{/if}
			</div>
			<div class="route-option__fields">
				<label class="visually-hidden" for={`item-${document.id}`}
					>{t('inbox.existingItemSelect')}</label
				>
				<select id={`item-${document.id}`} name="itemId">
					<option value="">{t('inbox.select')}</option>
					{#each data.items as item (item.id)}
						<option value={item.id} selected={item.id === suggestedItemId()}>{item.title}</option>
					{/each}
				</select>
			</div>
		</div>

		<div class="route-option">
			<div class="route-option__choice">
				<input
					id={`destination-new-${document.id}`}
					type="radio"
					name="destination"
					value="new"
					checked={defaultDestination() === 'new'}
				/>
				{#if !suggestedItemId() && suggestedPlaybookId()}
					<label for={`destination-new-${document.id}`}>
						<span class="route-option__label-text">{t('inbox.newItem')}</span>
						<span class="suggested-badge" aria-hidden="true">{t('inbox.suggestion.badge')}</span>
					</label>
				{:else}
					<label for={`destination-new-${document.id}`}>{t('inbox.newItem')}</label>
				{/if}
			</div>
			<div class="route-option__fields route-option__fields--new">
				<div class="field-row">
					<label for={`title-${document.id}`}>{t('inbox.new.title')}</label>
					<input
						id={`title-${document.id}`}
						type="text"
						name="title"
						value={defaultTitle(document.filename)}
					/>
					<p class="hint">{t('inbox.new.titleHint')}</p>
				</div>
				<div class="field-row">
					<div class="field-row__head">
						<label for={`playbook-${document.id}`}>{t('inbox.playbook')}</label>
						<span class="field-row__optional">{t('inbox.playbook.optional')}</span>
					</div>
					<select id={`playbook-${document.id}`} name="playbookId">
						<option value="">{t('inbox.playbook.none')}</option>
						{#each data.playbooks as playbook (playbook.id)}
							<option value={playbook.id} selected={playbook.id === suggestedPlaybookId()}>
								{resolveLabel(playbook.name, playbook.labelI18n)}
							</option>
						{/each}
					</select>
					<p class="hint">{t('inbox.playbook.hint')}</p>
				</div>
			</div>
		</div>
	</fieldset>

	<label class="confirmation-row">
		<input type="checkbox" name="confirmed" value="yes" required />
		<span>{t('inbox.confirm')}</span>
	</label>

	<div class="route-actions">
		<button class="route-primary" type="submit">
			<span class="route-primary__existing">{t('inbox.routeExisting')}</span>
			<span class="route-primary__new">{t('inbox.routeNew')}</span>
		</button>
		<button class="text-action delete-action" type="submit" formaction="?/delete" formnovalidate>
			{t('inbox.delete')}
		</button>
	</div>
</form>

<style>
	.route-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		min-width: 0;
	}

	.document-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-3);
	}

	.file-tile {
		width: 34px;
		height: 34px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		background: var(--color-hairline);
		color: var(--color-text-muted);
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		flex: none;
	}

	.document-head__copy {
		min-width: 0;
		flex: 1 1 200px;
	}

	.document-head h2 {
		width: 100%;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-action);
	}

	.document-head .meta {
		margin: var(--space-1) 0 0;
	}

	.text-action {
		flex: none;
		min-height: var(--control-h);
		padding: 0 var(--space-1);
		border-color: transparent;
		background: transparent;
		color: var(--color-accent);
		font-weight: 500;
	}

	.text-action:hover {
		border-color: transparent;
		background: transparent;
		color: var(--color-accent-hover);
	}

	.delete-action {
		color: var(--color-text-muted);
	}

	.delete-action:hover,
	.delete-action:focus-visible {
		color: var(--color-danger);
	}

	.suggestion {
		min-width: 0;
		padding: var(--space-4);
		border-radius: var(--radius-md);
		background: var(--color-surface-hover);
	}

	.suggestion__head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
	}

	.suggestion h3,
	.suggestion p {
		margin: 0;
	}

	.suggestion h3,
	.route-choices legend {
		padding: 0;
		font-size: var(--text-body);
		font-weight: 700;
		letter-spacing: normal;
		text-transform: none;
		color: var(--color-text);
	}

	.suggestion__time,
	.suggestion__hint {
		font-size: var(--text-meta);
		color: var(--color-text-muted);
	}

	.suggestion > p:not(.suggestion__hint) {
		margin-top: var(--space-2);
		max-width: 58ch;
		font-size: var(--text-body);
		color: var(--color-text-body);
	}

	.suggestion__hint {
		margin-top: var(--space-2) !important;
	}

	.route-choices {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.route-choices legend {
		margin-bottom: var(--space-3);
	}

	.route-option {
		min-width: 0;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.route-option:has(> .route-option__choice > input:checked) {
		border-color: var(--color-accent);
	}

	.route-option:has(> .route-option__choice > input:focus-visible) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.route-option__choice {
		min-height: var(--control-h);
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
		gap: var(--space-2) var(--space-3);
	}

	.route-option__choice input {
		width: 1.125rem;
		height: 1.125rem;
		margin: 0;
		accent-color: var(--color-accent);
		align-self: center;
		flex: none;
	}

	.route-option__choice label {
		min-width: 0;
		min-height: var(--control-h);
		flex: 1 1 160px;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-body);
		font-weight: 600;
		cursor: pointer;
	}

	.route-option__label-text {
		min-width: 0;
		flex: 1 1 auto;
	}

	.suggested-badge {
		align-self: center;
		flex: 0 0 auto;
		max-width: 100%;
		margin: var(--space-1) 0;
		padding: 0.1rem 0.5rem;
		border-radius: var(--radius-pill);
		background: var(--color-accent-soft);
		color: var(--color-accent);
		font-size: var(--text-meta);
		font-weight: 600;
		white-space: nowrap;
	}

	.route-option__fields {
		margin: var(--space-2) 0 var(--space-2) calc(1.125rem + var(--space-3));
	}

	.route-option__fields--new {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.route-option:has(> .route-option__choice > input:not(:checked)) .route-option__fields {
		display: none;
	}

	.confirmation-row {
		min-height: var(--control-h);
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-body);
		cursor: pointer;
	}

	.confirmation-row input {
		width: 1.125rem;
		height: 1.125rem;
		margin: 0;
		accent-color: var(--color-accent);
	}

	.route-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.route-primary {
		min-height: var(--control-h);
		max-width: 100%;
		white-space: normal;
	}

	.route-primary__new {
		display: none;
	}

	.route-form:has(input[name='destination'][value='new']:checked) .route-primary__existing {
		display: none;
	}

	.route-form:has(input[name='destination'][value='new']:checked) .route-primary__new {
		display: inline;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 640px) {
		.document-head {
			align-items: flex-start;
		}

		.suggestion {
			padding: var(--space-3);
		}

		.route-option {
			width: 100%;
			padding: var(--space-3);
		}

		.route-option__choice label:has(.suggested-badge) {
			flex-direction: column;
			align-items: flex-start;
			justify-content: center;
			gap: 0;
		}

		.route-option__choice .suggested-badge {
			align-self: flex-start;
			margin: 0;
		}

		.route-option__fields {
			margin-left: 0;
		}

		.route-option select,
		.route-option input[type='text'] {
			max-width: none;
		}

		.route-actions {
			align-items: stretch;
			flex-direction: column;
			gap: var(--space-2);
		}

		.route-primary,
		.delete-action {
			width: 100%;
		}
	}
</style>
