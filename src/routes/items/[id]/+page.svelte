<script lang="ts">
	import CustomFieldForm from '$lib/components/CustomFieldForm.svelte';
	import FieldInput from '$lib/components/FieldInput.svelte';
	import ManualActionForm from '$lib/components/ManualActionForm.svelte';
	import WorkflowTimeline from '$lib/components/WorkflowTimeline.svelte';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { formatCurrencyDisplay, formatDate } from '$lib/ui/format';
	import { effectiveDueDate } from '$lib/domain/action/action';
	import type { Field } from '$lib/domain/field/field';
	import type { ActionData, PageData } from './$types';

	/** Read-only display for one field's value, by type — the one place
	 *  this ternary lives instead of being repeated at each call site. */
	function formatFieldValue(field: Pick<Field, 'type' | 'value'>): string {
		if (!field.value) return '';
		if (field.type === 'date') return formatDate(field.value);
		if (field.type === 'currency') return formatCurrencyDisplay(field.value);
		return field.value;
	}

	import AttachmentList from '$lib/components/AttachmentList.svelte';
	import AttachmentUploadForm from '$lib/components/AttachmentUploadForm.svelte';
	import DocumentList from '$lib/components/DocumentList.svelte';
	import CycleCompletionPanel from '$lib/components/CycleCompletionPanel.svelte';
	import ArchiveItemForm from '$lib/components/ArchiveItemForm.svelte';
	import RelatedItemsSection from '$lib/components/RelatedItemsSection.svelte';
	import ItemHistory from '$lib/components/ItemHistory.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/* Presentation-only: the first action the domain already reports as
	   available and open is the one the user should look at first. */
	let next = $derived(data.overview.nextAction);
	let hasWorkflow = $derived(data.workflow.length > 0);
	let isArchived = $derived(data.item.status === 'ARCHIVED');

	/* "Angaben" always defaults to the read-only Normal view; Manage only
	   opens on click, never automatically, regardless of empty fields. */
	let fieldsManageOpenByDefault = false;

	/* Same Normal/Manage split, same default-open rule as "Angaben": with
	   nothing to show read-only yet (no documents at all), Manage opens by
	   default so uploading the first one never needs an extra click. */
	let attachmentsManageOpenByDefault = $derived(data.attachments.length === 0);
</script>

<div class="page-head">
	<a class="backlink" href={resolve('/')}>← {t('nav.whatsNext')}</a>
	<h1>{data.item.title}</h1>
	{#if data.item.playbookName}
		<p>{t('items.detail.playbookProvenance')}: {data.item.playbookName}</p>
	{/if}
	{#if data.newerPlaybookVersion}
		<p class="hint">
			{t('items.detail.playbookNewerVersion', { version: data.newerPlaybookVersion })}
		</p>
	{/if}
	{#if isArchived}
		<div class="notice section" role="status">
			<span class="notice__title">{t('items.detail.archived')}</span>
			<span class="notice__body">
				{#if data.item.archivedAt}
					{t('items.detail.archivedOn', { date: formatDate(data.item.archivedAt) })}
				{/if}
				— {t('items.detail.archivedReadOnly')}
			</span>
			<form method="POST" action="?/unarchiveItem" class="form-actions">
				<button type="submit">{t('items.detail.unarchive')}</button>
			</form>
		</div>
	{/if}
</div>

{#if form?.error}
	<div class="notice notice--error section" role="alert">
		<span class="notice__title">{t('items.detail.saveFailed')}</span>
		<span class="notice__body">{form.error}</span>
	</div>
{/if}

{#if !isArchived && data.snapshotInvalid}
	<div class="notice notice--error section" role="status">
		<span class="notice__body">{t('items.detail.snapshotInvalid')}</span>
	</div>
{/if}

<!-- 1 · Als Nächstes -->
{#if !isArchived}
	<section class="section" aria-labelledby="next-up-label">
		<div class="surface next-up">
			<div class="next-up__text">
				<span class="next-up__label" id="next-up-label">{t('items.detail.next')}</span>
				{#if next}
					<span class="next-up__action">{next.action.label}</span>
					<span class="next-up__state">
						{#if effectiveDueDate(next.action)}
							{t('whatsNext.dueOn')} {formatDate(effectiveDueDate(next.action)!)}
						{:else}
							{t('items.detail.status.now')} — {t('items.detail.status.noDate')}
						{/if}
					</span>
				{:else}
					<span class="next-up__action">{t('items.detail.noOpenAction')}</span>
					<span class="hint">{t('items.detail.noOpenActionHint')}</span>
				{/if}
			</div>
			{#if next}
				<form method="POST" action="?/completeAction" class="form-actions">
					<input type="hidden" name="actionId" value={next.action.id} />
					<button type="submit">{t('whatsNext.done')}</button>
					<button type="submit" formaction="?/skipAction" class="secondary">
						{t('whatsNext.skip')}
					</button>
				</form>
			{/if}
		</div>
	</section>
{/if}

{#if data.overview.importantFields.length > 0 || data.overview.documentCount > 0 || data.overview.relationCount > 0}
	<section class="item-overview section" aria-label={t('items.detail.overview')}>
		{#if data.overview.importantFields.length > 0}
			<div class="item-overview__values">
				{#each data.overview.importantFields as field (field.id)}
					<div class="item-overview__value">
						<span class="item-overview__label">{field.label}</span>
						<span class="item-overview__content">{formatFieldValue(field)}</span>
					</div>
				{/each}
			</div>
		{/if}
		{#if data.overview.documentCount > 0 || data.overview.relationCount > 0}
			<div class="item-overview__context">
				{#if data.overview.documentCount > 0}
					<a href="#attachments"
						>{t(
							data.overview.documentCount === 1
								? 'items.detail.overviewDocumentOne'
								: 'items.detail.overviewDocuments',
							{ count: String(data.overview.documentCount) }
						)}</a
					>
				{:else}
					<span class="item-overview__zero">{t('items.detail.overviewDocumentsNone')}</span>
				{/if}
				<span aria-hidden="true">·</span>
				{#if data.overview.relationCount > 0}
					<a href="#relations"
						>{t(
							data.overview.relationCount === 1
								? 'items.detail.overviewRelationOne'
								: 'items.detail.overviewRelations',
							{ count: String(data.overview.relationCount) }
						)}</a
					>
				{:else}
					<span class="item-overview__zero"
						>{t('items.detail.overviewRelations', { count: '0' })}</span
					>
				{/if}
			</div>
		{/if}
	</section>
{/if}

<!-- 2 · Abschluss -->
{#if !isArchived && data.cycleComplete}
	<CycleCompletionPanel canStartNextCycle={data.canStartNextCycle} />
{/if}

<!-- 3 · Ablauf -->
{#if hasWorkflow}
	<section class="section" aria-labelledby="workflow-label">
		<h2 class="section__label" id="workflow-label">{t('items.detail.workflow')}</h2>
		<WorkflowTimeline workflow={data.workflow} readOnly={isArchived} />
	</section>
{/if}

{#if data.pendingExtractionRun}
	<div class="notice section" role="status">
		<span class="notice__body">
			{t('ai.pending.notice')}
			<a
				href={resolve('/items/[id]/suggestions/[runId]', {
					id: data.item.id,
					runId: data.pendingExtractionRun.id
				})}>{t('ai.review.title')}</a
			>
		</span>
	</div>
{/if}

<!-- 4 · Dokumente -->
<section class="section" id="attachments" aria-labelledby="attachments-label">
	{#if isArchived}
		<h2 class="section__label" id="attachments-label">{t('items.detail.attachments')}</h2>
		{#if data.attachments.length === 0}
			<p class="hint">{t('items.detail.attachmentsEmpty')}</p>
		{:else}
			<DocumentList
				itemId={data.item.id}
				attachments={data.attachments}
				cycleSequences={data.attachmentCycleSequences}
			/>
		{/if}
	{:else}
		<details class="fields-panel" open={attachmentsManageOpenByDefault}>
			<summary>
				<h2 class="fields-panel__title" id="attachments-label">{t('items.detail.attachments')}</h2>
				<span class="fields-panel__enter">{t('items.detail.manageAttachments')}</span>
				<span class="fields-panel__active">
					<span class="fields-panel__active-label">
						<span class="fields-panel__dot" aria-hidden="true"></span>
						{t('items.detail.manageAttachmentsActive')}
					</span>
					<span class="fields-panel__done">{t('items.detail.manageAttachmentsDone')}</span>
				</span>
			</summary>
			<AttachmentList
				itemId={data.item.id}
				attachments={data.attachments}
				cycleSequences={data.attachmentCycleSequences}
			/>
			<AttachmentUploadForm />
		</details>

		{#if data.attachments.length === 0}
			<p class="hint fields-view">{t('items.detail.attachmentsEmpty')}</p>
		{:else}
			<div class="fields-view">
				<DocumentList
					itemId={data.item.id}
					attachments={data.attachments}
					cycleSequences={data.attachmentCycleSequences}
				/>
			</div>
		{/if}
	{/if}
</section>
{#if !isArchived || data.relatedItems.length > 0}
	<RelatedItemsSection
		itemId={data.item.id}
		relatedItems={data.relatedItems}
		candidates={data.relationCandidates}
		query={data.relationQuery}
		manage={data.relationsManage}
		archived={isArchived}
	/>
{/if}
{#if data.fields.length > 0 || !isArchived}
	<section class="section" aria-labelledby="fields-label">
		{#if isArchived}
			<h2 class="section__label" id="fields-label">{t('items.detail.fields')}</h2>
			<div class="data-list">
				{#each data.fields as field (field.id)}
					<div class="data-row" class:data-row--empty={!field.value}>
						<span class="data-row__key">{field.label}</span>
						<span class="data-row__value">
							{field.value ? formatFieldValue(field) : '—'}
						</span>
					</div>
				{/each}
			</div>
			<p class="hint">{t('items.detail.historyReadOnly')}</p>
		{:else}
			<details class="fields-panel" open={fieldsManageOpenByDefault}>
				<summary>
					<h2 class="fields-panel__title" id="fields-label">{t('items.detail.fields')}</h2>
					<span class="fields-panel__enter">{t('items.detail.manageFields')}</span>
					<span class="fields-panel__active">
						<span class="fields-panel__active-label">
							<span class="fields-panel__dot" aria-hidden="true"></span>
							{t('items.detail.manageFieldsActive')}
						</span>
						<span class="fields-panel__done">{t('items.detail.manageFieldsDone')}</span>
					</span>
				</summary>

				{#if data.fields.length > 0}
					<form method="POST" action="?/updateFields" class="form-panel fields-update-form">
						<!-- Placed before the field rows in DOM order (see
						     .fields-update-form CSS `order`) so it — not a
						     removable field's hidden "Entfernen" button — is the
						     form's default submit: pressing Enter in any field
						     must save, never delete a custom field. -->
						<div class="form-actions">
							<button type="submit">{t('items.detail.save')}</button>
							<span class="hint">{t('items.detail.fieldsOptionalHint')}</span>
						</div>
						<div class="fields-update-form__fields">
							{#each data.fields as field (field.id)}
								<FieldInput {field} removable={field.origin === 'CUSTOM'} />
							{/each}
						</div>
					</form>
				{/if}

				<CustomFieldForm />
			</details>

			{#if data.fields.length > 0}
				<div class="data-list fields-view">
					{#each data.fields as field (field.id)}
						<div class="data-row" class:data-row--empty={!field.value}>
							<span class="data-row__key">
								{field.label}
								{#if field.recommended && !field.value}
									<span class="hint">— {t('items.detail.recommendedInlineHint')}</span>
								{/if}
							</span>
							{#if field.value}
								<span class="data-row__value">{formatFieldValue(field)}</span>
							{:else}
								<a href="#field-{field.fieldKey}">{t('items.detail.addValue')}</a>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</section>
{/if}

<!-- 5 · Notiz -->
{#if data.item.note}
	<section class="section" aria-labelledby="note-label">
		<h2 class="section__label" id="note-label">{t('items.detail.notes')}</h2>
		<p class="note-text">{data.item.note}</p>
	</section>
{/if}

<!-- 6 · Verlauf -->
<ItemHistory
	events={data.historyEvents}
	total={data.historyTotal}
	limit={data.historyPageSize}
	cycleHistory={data.history}
/>

<!-- 7 · Bearbeiten -->
{#if !isArchived}
	<section class="section" aria-labelledby="more-label">
		<h2 class="section__label" id="more-label">{t('items.detail.more')}</h2>
		<div class="form-stack">
			<ManualActionForm />
			<ArchiveItemForm />
		</div>
	</section>
{/if}
