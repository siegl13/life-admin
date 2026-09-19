<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		formatByteSize,
		MAX_ATTACHMENT_BYTES,
		type AttachmentMimeType
	} from '$lib/domain/attachment/attachment';
	import { resolveLabel, t } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
	const FILE_ACCEPT = ACCEPTED_MIME_TYPES.join(',');
	const MAX_UPLOAD_MEGABYTES = MAX_ATTACHMENT_BYTES / 1024 / 1024;

	type InboxDocument = PageData['documents'][number];

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let openDocumentId = $derived.by(() => {
		const requestedId = page.url.searchParams.get('doc');
		return data.documents.some((document) => document.id === requestedId)
			? requestedId
			: data.documents[0]?.id;
	});

	function relativeTime(value: string): string {
		const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
		if (minutes < 1) return t('settings.notify.justNow');
		return t('settings.notify.minutesAgo', { minutes: String(minutes) });
	}

	function typeAbbreviation(mimeType: AttachmentMimeType): string {
		if (mimeType === 'application/pdf') return 'PDF';
		if (mimeType === 'image/jpeg') return 'JPG';
		if (mimeType === 'image/png') return 'PNG';
		return 'WEBP';
	}

	function defaultTitle(filename: string): string {
		return filename.replace(/\.[^.]+$/, '').trim() || filename;
	}

	function suggestedItemId(document: InboxDocument): string | null {
		return (
			data.items.find((item) => document.suggestion?.suggestedItemIds.includes(item.id))?.id ?? null
		);
	}

	function suggestedPlaybookId(document: InboxDocument): string | null {
		return (
			data.playbooks.find((playbook) => playbook.id === document.suggestion?.suggestedPlaybookId)
				?.id ?? null
		);
	}

	function suggestedTarget(document: InboxDocument): string | null {
		const item = data.items.find((candidate) => candidate.id === suggestedItemId(document));
		if (item) return item.title;
		const playbook = data.playbooks.find(
			(candidate) => candidate.id === suggestedPlaybookId(document)
		);
		return playbook ? resolveLabel(playbook.name, playbook.labelI18n) : null;
	}

	function defaultDestination(document: InboxDocument): 'existing' | 'new' {
		if (suggestedItemId(document)) return 'existing';
		if (suggestedPlaybookId(document)) return 'new';
		return data.items.length > 0 ? 'existing' : 'new';
	}
</script>

<div class="inbox-page-head">
	<div class="page-head inbox-page-head__copy">
		<h1>{t('inbox.title')}</h1>
		<p>{t('inbox.lead')}</p>
	</div>
	{#if data.documents.length > 0}
		<form method="POST" action="?/upload" enctype="multipart/form-data" class="upload-form">
			<label class="upload-picker button quiet">
				{t('inbox.upload.title')}
				<input type="file" name="file" accept={FILE_ACCEPT} required />
			</label>
			<button class="upload-form__submit" type="submit">{t('inbox.upload.submit')}</button>
		</form>
	{/if}
</div>

{#if form?.error}<div class="notice notice--error section" role="alert">{form.error}</div>{/if}

{#if data.documents.length === 0}
	<section class="inbox-empty" aria-labelledby="inbox-empty-title">
		<h2 id="inbox-empty-title">{t('inbox.empty.title')}</h2>
		<p>{t('inbox.empty.body')}</p>
		<form method="POST" action="?/upload" enctype="multipart/form-data" class="upload-form">
			<label class="upload-picker button">
				{t('inbox.empty.selectFile')}
				<input type="file" name="file" accept={FILE_ACCEPT} required />
			</label>
			<button class="upload-form__submit" type="submit">{t('inbox.upload.submit')}</button>
		</form>
		<p class="inbox-empty__formats">
			{t('inbox.empty.formats', { max: String(MAX_UPLOAD_MEGABYTES) })}
		</p>
	</section>
{:else}
	<div class="inbox-documents">
		{#each data.documents as document (document.id)}
			{#if document.id === openDocumentId}
				<article
					class="inbox-document inbox-document--open"
					aria-labelledby={`document-${document.id}`}
				>
					<form method="POST" action="?/route" class="route-form">
						<input type="hidden" name="documentId" value={document.id} />

						<header class="document-head">
							<div class="file-tile" aria-hidden="true">{typeAbbreviation(document.mimeType)}</div>
							<div class="document-head__copy">
								<h2 id={`document-${document.id}`}>{document.filename}</h2>
								<p class="meta">
									{formatByteSize(document.byteSize)} · {t('inbox.storedAt', {
										time: relativeTime(document.createdAt)
									})}
								</p>
							</div>
							{#if data.aiAvailable}
								<button
									class="text-action analyze-action"
									type="submit"
									formaction="?/analyze"
									formnovalidate>{t('inbox.analyze')}</button
								>
							{/if}
						</header>

						{#if document.suggestion}
							<section class="suggestion" aria-labelledby={`suggestion-${document.id}`}>
								<div class="suggestion__head">
									<h3 id={`suggestion-${document.id}`}>{t('inbox.suggestion.label')}</h3>
									<span
										>{t('inbox.suggestion.createdAt', {
											time: relativeTime(document.updatedAt)
										})}</span
									>
								</div>
								<p>
									{#if document.suggestion.documentKind}{t('inbox.suggestion.kind', {
											kind: document.suggestion.documentKind
										})}{/if}
									{#if suggestedTarget(document)}
										{t('inbox.suggestion.target', {
											target: suggestedTarget(document) ?? ''
										})}{/if}
									{#if !document.suggestion.documentKind && !suggestedTarget(document)}{t(
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
										checked={defaultDestination(document) === 'existing'}
									/>
									<label for={`destination-existing-${document.id}`}
										>{t('inbox.existingItem')}</label
									>
									{#if suggestedItemId(document)}<span class="suggested-badge"
											>{t('inbox.suggestion.badge')}</span
										>{/if}
								</div>
								<div class="route-option__fields">
									<label class="visually-hidden" for={`item-${document.id}`}
										>{t('inbox.existingItemSelect')}</label
									>
									<select id={`item-${document.id}`} name="itemId">
										<option value="">{t('inbox.select')}</option>
										{#each data.items as item (item.id)}
											<option value={item.id} selected={item.id === suggestedItemId(document)}
												>{item.title}</option
											>
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
										checked={defaultDestination(document) === 'new'}
									/>
									<label for={`destination-new-${document.id}`}>{t('inbox.newItem')}</label>
									{#if !suggestedItemId(document) && suggestedPlaybookId(document)}<span
											class="suggested-badge">{t('inbox.suggestion.badge')}</span
										>{/if}
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
												<option
													value={playbook.id}
													selected={playbook.id === suggestedPlaybookId(document)}
													>{resolveLabel(playbook.name, playbook.labelI18n)}</option
												>
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
							<button
								class="text-action delete-action"
								type="submit"
								formaction="?/delete"
								formnovalidate>{t('inbox.delete')}</button
							>
						</div>
					</form>
				</article>
			{:else}
				<article
					class="inbox-document inbox-document--closed"
					aria-labelledby={`document-${document.id}`}
				>
					<div class="file-tile" aria-hidden="true">{typeAbbreviation(document.mimeType)}</div>
					<div class="closed-document__copy">
						<h2 id={`document-${document.id}`}>{document.filename}</h2>
						<p class="meta">
							{formatByteSize(document.byteSize)} · {t('inbox.storedAt', {
								time: relativeTime(document.createdAt)
							})}
						</p>
					</div>
					<a
						class="closed-document__action"
						href={resolve(`/inbox?doc=${encodeURIComponent(document.id)}`)}>{t('inbox.assign')}</a
					>
				</article>
			{/if}
		{/each}
	</div>
{/if}

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

	.inbox-empty .upload-form {
		margin-top: var(--space-3);
	}

	.inbox-empty .inbox-empty__formats {
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}

	.inbox-documents {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.inbox-document {
		min-width: 0;
	}

	.inbox-document + .inbox-document {
		border-top: 1px solid var(--color-hairline);
	}

	.inbox-document--open {
		padding: var(--space-5);
	}

	.route-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		min-width: 0;
	}

	.document-head {
		display: grid;
		grid-template-columns: 34px minmax(0, 1fr) auto;
		align-items: start;
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
	}

	.document-head__copy,
	.closed-document__copy {
		min-width: 0;
	}

	.document-head h2,
	.closed-document__copy h2 {
		margin: 0;
		font-size: var(--text-action);
		overflow-wrap: anywhere;
	}

	.document-head .meta,
	.closed-document__copy .meta {
		margin: var(--space-1) 0 0;
	}

	.text-action {
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

	.suggestion {
		margin-left: calc(34px + var(--space-3));
		padding-left: var(--space-4);
		border-left: 3px solid var(--color-accent-quiet);
	}

	.suggestion__head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
	}

	.suggestion h3,
	.suggestion p {
		margin: 0;
	}

	.suggestion h3 {
		font-size: var(--text-label);
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.suggestion__head span,
	.suggestion__hint {
		font-size: var(--text-meta);
		color: var(--color-text-faint);
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
		padding: 0;
		font-size: var(--text-label);
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted);
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

	.route-option__choice {
		min-height: var(--control-h);
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.route-option__choice input {
		width: 1.125rem;
		height: 1.125rem;
		margin: 0;
		accent-color: var(--color-accent);
		flex: none;
	}

	.route-option__choice label {
		flex: 1;
		font-size: var(--text-body);
		font-weight: 600;
		cursor: pointer;
	}

	.suggested-badge {
		font-size: var(--text-meta);
		font-weight: 600;
		color: var(--color-text-muted);
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
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.route-primary {
		min-height: var(--control-h);
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

	.inbox-document--closed {
		display: grid;
		grid-template-columns: 34px minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-5);
	}

	.closed-document__copy h2 {
		font-size: var(--text-body);
	}

	.closed-document__action {
		min-height: var(--control-h);
		display: inline-flex;
		align-items: center;
		font-size: var(--text-body);
		font-weight: 600;
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
		.inbox-page-head {
			align-items: stretch;
			flex-direction: column;
			gap: var(--space-4);
		}

		.inbox-page-head .upload-form {
			justify-content: flex-start;
		}

		.inbox-empty {
			padding: var(--space-7) var(--space-4);
		}

		.inbox-document--open {
			padding: var(--space-4);
		}

		.document-head {
			grid-template-columns: 34px minmax(0, 1fr);
		}

		.analyze-action {
			grid-column: 2;
			justify-self: start;
		}

		.suggestion {
			margin-left: 0;
		}

		.route-option {
			width: 100%;
			padding: var(--space-3);
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

		.inbox-document--closed {
			padding-left: var(--space-4);
			padding-right: var(--space-4);
		}
	}
</style>
