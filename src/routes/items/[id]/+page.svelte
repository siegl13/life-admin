<script lang="ts">
	import CustomFieldForm from '$lib/components/CustomFieldForm.svelte';
	import FieldInput from '$lib/components/FieldInput.svelte';
	import ItemFacts from '$lib/components/ItemFacts.svelte';
	import ManualActionForm from '$lib/components/ManualActionForm.svelte';
	import WorkflowTimeline from '$lib/components/WorkflowTimeline.svelte';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { formatDate, formatDueDayCount } from '$lib/ui/format';
	import { canEditActionDueDate } from '$lib/ui/itemDetail';
	import { effectiveDueDate } from '$lib/domain/action/action';
	import type { ActionData, PageData } from './$types';

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

	function dueDialogId(actionId: string): string {
		return `due-dialog-${actionId}`;
	}

	/** Opens the due-date dialog the workflow timeline already renders for
	 *  this action — the hero/sticky bar triggers it by id instead of
	 *  rendering a second editor, so there is exactly one per action. */
	function openDueDialog(actionId: string) {
		(document.getElementById(dueDialogId(actionId)) as HTMLDialogElement | null)?.showModal();
	}

	let nextDueDistance = $derived(
		next && effectiveDueDate(next.action)
			? formatDueDayCount(effectiveDueDate(next.action)!, data.today)
			: null
	);
	let nextCanEditDue = $derived(next ? canEditActionDueDate(next.action) : false);

	/* Same Normal/Manage split, same default-open rule as "Angaben": with
	   nothing to show read-only yet (no documents at all), Manage opens by
	   default so uploading the first one never needs an extra click. */
	let attachmentsManageOpenByDefault = $derived(data.attachments.length === 0);
</script>

<div class="item-detail-page page-container page-container--wide">
	<div class="page-head">
		<a class="backlink" href={resolve('/')}>← {t('nav.whatsNext')}</a>
		<div class="page-head__row">
			<h1>{data.item.title}</h1>
			{#if data.item.playbookName}
				<span class="pill" title="{t('items.detail.playbookProvenance')}: {data.item.playbookName}">
					{data.item.playbookName}
				</span>
			{/if}
		</div>
		<div class="page-head__context">
			{#if data.item.createdAt}
				<span>{t('items.detail.createdOn')} {formatDate(data.item.createdAt.slice(0, 10))}</span>
			{/if}
		</div>
		{#if data.newerPlaybookVersion}
			<p class="hint">
				{t('items.detail.playbookNewerVersion', { version: data.newerPlaybookVersion })}
			</p>
		{/if}
		{#if !isArchived}
			<!-- Secondary: edit/more are existing in-page anchors, not new routes
		     or business actions. -->
			<nav class="page-head__secondary" aria-label={t('items.detail.more')}>
				<a
					class="button secondary"
					href={resolve('/items/[id]?manage=relations#relations', { id: data.item.id })}
					>{t('items.detail.linkItem')}</a
				>
				<a class="button secondary" href="#more-label">{t('items.detail.more')}</a>
			</nav>
		{/if}
		{#if isArchived}
			<div class="notice section" role="status">
				<span class="notice__title">{t('items.detail.archived')}</span>
				<span class="notice__body">
					{#if data.item.archivedAt}
						{t('items.detail.archivedOn', { date: formatDate(data.item.archivedAt) })}
						<span aria-hidden="true">·</span>
					{/if}
					{t('items.detail.archivedReadOnly')}
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
								{formatDate(effectiveDueDate(next.action)!)}
								{#if nextDueDistance}· {nextDueDistance}{/if}
							{:else}
								{t('items.detail.status.now')} <span aria-hidden="true">·</span>
								{t('items.detail.status.noDate')}
							{/if}
						</span>
					{:else}
						<span class="next-up__action">{t('items.detail.noOpenAction')}</span>
						<span class="hint">{t('items.detail.noOpenActionHint')}</span>
					{/if}
				</div>
				<!-- Desktop only (hidden <768px, see .next-up__actions CSS): the
			     sticky bar below is the phone equivalent, owning the same
			     controls so neither surface duplicates the other. -->
				{#if next}
					<form method="POST" action="?/completeAction" class="form-actions next-up__actions">
						<input type="hidden" name="actionId" value={next.action.id} />
						<button type="submit">{t('whatsNext.done')}</button>
						<button type="submit" formaction="?/skipAction" class="secondary">
							{t('whatsNext.skip')}
						</button>
						{#if nextCanEditDue}
							<button
								type="button"
								class="secondary"
								onclick={() => openDueDialog(next!.action.id)}
							>
								{t('items.detail.changeDueDate')}
							</button>
						{/if}
					</form>
				{/if}
			</div>
		</section>
	{/if}

	{#if !isArchived && next}
		<!-- Phone only (hidden >=768px): one sticky bar owning complete + a
	     native secondary menu, positioned clear of the global tabbar (see
	     .sticky-action-bar CSS using --mobile-floating-reserve). -->
		<form method="POST" action="?/completeAction" class="sticky-action-bar">
			<input type="hidden" name="actionId" value={next.action.id} />
			<button type="submit" class="sticky-action-bar__primary">{t('whatsNext.done')}</button>
			<details class="sticky-action-bar__more">
				<summary aria-label={t('items.detail.more')}>⋯</summary>
				<div class="sticky-action-bar__menu">
					<button type="submit" formaction="?/skipAction" class="secondary">
						{t('whatsNext.skip')}
					</button>
					{#if nextCanEditDue}
						<button type="button" class="secondary" onclick={() => openDueDialog(next!.action.id)}>
							{t('items.detail.changeDueDate')}
						</button>
					{/if}
				</div>
			</details>
		</form>
	{/if}

	<div class="item-detail-layout">
		<div class="item-detail-main">
			<!-- 2 · Abschluss -->
			{#if !isArchived && data.cycleComplete}
				<CycleCompletionPanel canStartNextCycle={data.canStartNextCycle} />
			{/if}

			<!-- 3 · Ablauf -->
			{#if hasWorkflow}
				<section class="section" aria-labelledby="workflow-label">
					<h2 class="section__label" id="workflow-label">{t('items.detail.workflow')}</h2>
					<WorkflowTimeline
						workflow={data.workflow}
						snoozes={data.snoozes}
						today={data.today}
						readOnly={isArchived}
						featuredActionId={!isArchived ? (next?.action.id ?? null) : null}
						{form}
					/>
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

			<section class="section" aria-labelledby="fields-label">
				{#if isArchived}
					<h2 class="section__label" id="fields-label">{t('items.detail.fields')}</h2>
					<ItemFacts fields={data.fields} readOnly />
				{:else}
					<details class="fields-panel">
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

					<div class="fields-view">
						<ItemFacts fields={data.fields} />
					</div>
				{/if}
			</section>

			<!-- 5 · Notiz -->
			{#if data.item.note}
				<section class="section" aria-labelledby="note-label">
					<h2 class="section__label" id="note-label">{t('items.detail.notes')}</h2>
					<p class="note-text">{data.item.note}</p>
				</section>
			{/if}

			<!-- 7 · Bearbeiten: aligned with the main column, not spanning the
			     full width/side column, so it reads as part of the same content
			     flow rather than a page-wide footer. -->
			{#if !isArchived}
				<section class="section" aria-labelledby="more-label">
					<h2 class="section__label" id="more-label">{t('items.detail.more')}</h2>
					<div class="form-stack">
						<ManualActionForm />
						<ArchiveItemForm />
					</div>
				</section>
			{/if}
		</div>

		<!-- Desktop side column: documents, related items, history. Stacks below
     the main column on phone (see .item-detail-layout CSS), in this same
     order, with the exact same components/anchors/forms as before. -->
		<div class="item-detail-side">
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
							<h2 class="fields-panel__title" id="attachments-label">
								{t('items.detail.attachments')}
							</h2>
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

			<!-- 6 · Verlauf -->
			<ItemHistory
				events={data.historyEvents}
				total={data.historyTotal}
				limit={data.historyPageSize}
				cycleHistory={data.history}
			/>
		</div>
	</div>
</div>
