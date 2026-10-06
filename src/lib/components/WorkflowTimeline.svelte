<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatDate } from '$lib/ui/format';
	import { effectiveDueDate } from '$lib/domain/action/action';
	import type { WorkflowAction } from '$lib/application/items/getItemWorkflow';
	import type { NotificationSnooze } from '$lib/domain/notify/snooze';

	type TimelineFormResult = {
		error?: string;
		context?: 'snooze' | 'dueOverride';
		actionId?: string;
		snoozedUntil?: string;
		dueDate?: string | null;
	} | null;

	let {
		workflow,
		snoozes = {},
		today,
		readOnly = false,
		form = null
	}: {
		workflow: readonly WorkflowAction[];
		snoozes?: Record<string, NotificationSnooze | null>;
		today: string;
		readOnly?: boolean;
		form?: TimelineFormResult;
	} = $props();

	type StepState = 'done' | 'skipped' | 'now' | 'waiting';

	function stateOf(entry: WorkflowAction): StepState {
		if (entry.action.state === 'DONE') return 'done';
		if (entry.action.state === 'SKIPPED') return 'skipped';
		return entry.available ? 'now' : 'waiting';
	}

	const stateLabel: Record<StepState, string> = {
		done: t('items.detail.status.done'),
		skipped: t('items.detail.status.skipped'),
		now: t('items.detail.status.now'),
		waiting: t('items.detail.status.waitingShort')
	};

	let steps = $derived(workflow.map((entry) => ({ entry, state: stateOf(entry) })));

	/**
	 * The due date is editable for ANY open DERIVED action with a
	 * resolved calculated date (or an existing override to manage) — not
	 * only the currently "now" one. A future step blocked purely on an
	 * earlier dependency already has a known suggestion the user may
	 * already want to adjust. An action still blocked because its OWN
	 * date is unresolved has nothing to override yet (unless a stray
	 * override already exists from an earlier state), and this never
	 * changes availability itself — see effectiveDueDate's doc comment.
	 */
	function canEditDueDate(entry: WorkflowAction): boolean {
		return (
			entry.action.state === 'OPEN' &&
			entry.action.dueKind === 'DERIVED' &&
			(entry.action.dueDate !== null || entry.action.dueOverrideDate !== null)
		);
	}

	function canSnooze(entry: WorkflowAction): boolean {
		return (
			entry.available && entry.action.state === 'OPEN' && effectiveDueDate(entry.action) !== null
		);
	}

	function dueDialogId(actionId: string): string {
		return `due-dialog-${actionId}`;
	}

	function snoozeDialogId(actionId: string): string {
		return `snooze-dialog-${actionId}`;
	}

	function openDialog(id: string) {
		(document.getElementById(id) as HTMLDialogElement | null)?.showModal();
	}

	function closeDialog(event: MouseEvent) {
		(event.currentTarget as HTMLElement).closest('dialog')?.close();
	}

	/** A real backdrop tap: the click target is the <dialog> itself (it has
	 *  no wrapper element), but that's also true of a click on the
	 *  dialog's own padding — so target equality alone can't tell "outside"
	 *  from "inside the padded editor". Comparing the pointer position
	 *  against the dialog's own box does: only a point outside that box is
	 *  the ::backdrop. */
	function closeOnBackdropClick(event: MouseEvent) {
		const dialog = event.currentTarget as HTMLDialogElement;
		if (event.target !== dialog) return;
		const { left, right, top, bottom } = dialog.getBoundingClientRect();
		const outside =
			event.clientX < left ||
			event.clientX > right ||
			event.clientY < top ||
			event.clientY > bottom;
		if (outside) dialog.close();
	}

	/** Every dialog renders statically `open` so the editor stays fully
	 *  reachable with no JavaScript at all (same editor, just not yet a
	 *  focus-trapped modal — the SSR/no-JS fallback this project already
	 *  relies on everywhere else). Once the component hydrates, every one
	 *  of them is closed immediately so the compact trigger row — and the
	 *  real focus-trap/Escape/outside-tap modal behaviour — takes over. */
	$effect(() => {
		document.querySelectorAll('dialog.action-dialog[open]').forEach((dialog) => {
			(dialog as HTMLDialogElement).close();
		});
	});

	/** A rejected snooze/due submission must reopen its own dialog with
	 *  the entered value and the error still visible, never silently fall
	 *  back to the closed compact row (losing what the user typed). */
	$effect(() => {
		if (!form?.actionId || !form.context) return;
		const id =
			form.context === 'snooze' ? snoozeDialogId(form.actionId) : dueDialogId(form.actionId);
		(document.getElementById(id) as HTMLDialogElement | null)?.showModal();
	});
</script>

<!--
	A quiet vertical timeline, not a workflow editor: dot shape (filled /
	ring / dashed), an explicit state word and a plain-language line of
	explanation carry the state — never colour on its own.
-->
<ol class="timeline">
	{#each steps as { entry, state } (entry.action.id)}
		<li class="timeline__step timeline__step--{state}" id="action-{entry.action.id}">
			<span class="timeline__rail" aria-hidden="true">
				<span
					class="timeline__dot"
					class:timeline__dot--done={state === 'done' || state === 'skipped'}
					class:timeline__dot--now={state === 'now'}
				>
					{#if state === 'done'}✓{:else if state === 'skipped'}–{/if}
				</span>
				<span class="timeline__line"></span>
			</span>

			<span class="timeline__body">
				<span class="timeline__title">{entry.action.label}</span>
				<!-- On mobile, the step collapses to a single column and the
				     aligned-right state badge (`.timeline__state` below) ends
				     up after every control instead of next to the title. This
				     copy renders in its place there (hidden on wider screens,
				     where the badge already sits next to the title). -->
				<span
					class="timeline__status-inline"
					class:timeline__status-inline--done={state === 'done' || state === 'skipped'}
					class:timeline__status-inline--now={state === 'now'}
				>
					{stateLabel[state]}
				</span>
				{#if state === 'done'}
					<span class="hint">
						{t('items.detail.status.done')}{#if entry.action.completedAt}
							· {formatDate(entry.action.completedAt.slice(0, 10))}{/if}
					</span>
					{#if !readOnly}
						<form method="POST" action="?/reopenAction" class="timeline__controls">
							<input type="hidden" name="actionId" value={entry.action.id} />
							<button type="submit" class="link">{t('items.detail.reopen')}</button>
						</form>
					{/if}
				{:else if state === 'skipped'}
					<span class="hint">{t('items.detail.status.skipped')}</span>
					{#if !readOnly}
						<form method="POST" action="?/reopenAction" class="timeline__controls">
							<input type="hidden" name="actionId" value={entry.action.id} />
							<button type="submit" class="link">{t('items.detail.reopen')}</button>
						</form>
					{/if}
				{:else if state === 'now'}
					<!-- No extra hint line here: the "Jetzt möglich" state word
					     to the right already says this; repeating it as
					     "Kann jetzt erledigt werden." added a line without a
					     new fact. -->
				{:else if entry.blockedReason?.kind === 'unresolvedDate'}
					<span class="hint">
						{t('items.detail.status.unresolvedDate', { field: entry.blockedReason.fieldLabel })}
					</span>
					<span class="meta">
						{t('items.detail.status.unresolvedDateHint', {
							field: entry.blockedReason.fieldLabel
						})}
					</span>
				{:else if entry.blockedReason?.kind === 'dependency'}
					<span class="hint">
						{t('items.detail.status.blockedBy', {
							action: entry.blockedReason.blockingLabels.join(', ')
						})}
					</span>
				{:else}
					<span class="hint">{t('items.detail.status.waitingHint')}</span>
				{/if}

				<!-- "When is it due?" is answered right under the title/status
				     for every open step that has one — a MANUAL action's own
				     due date included — independently of whether that date
				     happens to be editable here (only DERIVED actions are). -->
				{#if (state === 'now' || state === 'waiting') && effectiveDueDate(entry.action)}
					<span class="meta">
						{t('whatsNext.dueOn')}
						{formatDate(effectiveDueDate(entry.action)!)}
					</span>
				{/if}

				{#if canEditDueDate(entry) && entry.action.dueOverrideDate}
					<span class="hint">
						{t('items.detail.dueOverrideActive')} ·
						{#if entry.action.dueDate}
							{t('items.detail.dueOverrideSuggestion', {
								date: formatDate(entry.action.dueDate)
							})}
						{:else}
							{t('items.detail.dueOverrideSuggestionUnresolved')}
						{/if}
						{#if !readOnly}
							·
							<form method="POST" action="?/resetActionDueOverride" class="timeline__due-form">
								<input type="hidden" name="actionId" value={entry.action.id} />
								<button type="submit" class="link">
									{t('items.detail.resetDueOverride')}
								</button>
							</form>
						{/if}
					</span>
				{/if}

				{#if state === 'now' && !readOnly}
					<form method="POST" action="?/completeAction" class="timeline__controls">
						<input type="hidden" name="actionId" value={entry.action.id} />
						<button type="submit" class="quiet">{t('whatsNext.done')}</button>
						<button type="submit" formaction="?/skipAction" class="secondary">
							{t('whatsNext.skip')}
						</button>
					</form>
				{/if}

				{#if canEditDueDate(entry) && !readOnly}
					<button
						type="button"
						class="timeline__secondary-trigger"
						onclick={() => openDialog(dueDialogId(entry.action.id))}
					>
						{t('items.detail.changeDueDate')}
					</button>
					<dialog
						id={dueDialogId(entry.action.id)}
						class="action-dialog"
						aria-labelledby="due-dialog-title-{entry.action.id}"
						open
						onclick={closeOnBackdropClick}
					>
						<strong class="action-dialog__title" id="due-dialog-title-{entry.action.id}">
							{t('items.detail.changeDueDate')}
						</strong>
						<p class="meta">
							{t('items.detail.dueCurrentLabel')}
							{#if effectiveDueDate(entry.action)}{formatDate(
									effectiveDueDate(entry.action)!
								)}{:else}{t('items.detail.status.noDate')}{/if}
						</p>
						<p class="meta">
							{t('items.detail.dueSuggestedLabel')}
							{#if entry.action.dueDate}{formatDate(entry.action.dueDate)}{:else}{t(
									'items.detail.dueOverrideSuggestionUnresolved'
								)}{/if}
						</p>
						{#if form?.context === 'dueOverride' && form.actionId === entry.action.id && form.error}
							<p class="notice notice--error" role="alert">{form.error}</p>
						{/if}
						<form method="POST" action="?/setActionDueOverride" class="form-stack">
							<input type="hidden" name="actionId" value={entry.action.id} />
							<div class="field-row">
								<label for="due-date-{entry.action.id}">{t('items.detail.dueDateLabel')}</label>
								<input
									id="due-date-{entry.action.id}"
									name="dueDate"
									type="date"
									value={form?.context === 'dueOverride' && form.actionId === entry.action.id
										? (form.dueDate ?? '')
										: (entry.action.dueOverrideDate ?? entry.action.dueDate ?? '')}
								/>
							</div>
							<div class="form-actions">
								<button type="submit" class="quiet">
									{t('items.detail.saveDueDate')}
								</button>
								<button type="button" class="link" onclick={closeDialog}>
									{t('common.cancel')}
								</button>
							</div>
						</form>
					</dialog>
				{/if}

				{#if canSnooze(entry) && !readOnly}
					{#if snoozes[entry.action.id]}
						<span class="hint">
							{t('items.detail.snoozeActive', {
								date: formatDate(snoozes[entry.action.id]!.snoozedUntil)
							})}
						</span>
						{#if effectiveDueDate(entry.action)}
							<span class="meta">
								{#if effectiveDueDate(entry.action)! < today}
									{t('due.overdueSince', { date: formatDate(effectiveDueDate(entry.action)!) })}
								{:else}
									{t('due.dueOn', { date: formatDate(effectiveDueDate(entry.action)!) })}
								{/if}
							</span>
						{/if}
						<form method="POST" action="?/clearSnooze" class="timeline__controls">
							<input type="hidden" name="actionId" value={entry.action.id} />
							<button type="submit" class="link">{t('items.detail.snoozeClear')}</button>
						</form>
					{/if}
					<button
						type="button"
						class="timeline__secondary-trigger"
						onclick={() => openDialog(snoozeDialogId(entry.action.id))}
					>
						{snoozes[entry.action.id] ? t('items.detail.snoozeReplace') : t('items.detail.snooze')}
					</button>
					<dialog
						id={snoozeDialogId(entry.action.id)}
						class="action-dialog"
						aria-labelledby="snooze-dialog-title-{entry.action.id}"
						open
						onclick={closeOnBackdropClick}
					>
						<strong class="action-dialog__title" id="snooze-dialog-title-{entry.action.id}">
							{snoozes[entry.action.id]
								? t('items.detail.snoozeReplace')
								: t('items.detail.snooze')}
						</strong>
						{#if form?.context === 'snooze' && form.actionId === entry.action.id && form.error}
							<p class="notice notice--error" role="alert">{form.error}</p>
						{/if}
						<form method="POST" action="?/setSnooze" class="snooze__form">
							<input type="hidden" name="actionId" value={entry.action.id} />
							<button type="submit" name="snoozedUntil" value="TOMORROW" class="secondary">
								{t('items.detail.snoozeTomorrow')}
							</button>
							<button type="submit" name="snoozedUntil" value="THREE_DAYS" class="secondary">
								{t('items.detail.snoozeThreeDays')}
							</button>
							<button type="submit" name="snoozedUntil" value="SEVEN_DAYS" class="secondary">
								{t('items.detail.snoozeSevenDays')}
							</button>
							<label>
								<span class="sr-only">{t('items.detail.snoozeCustom')}</span>
								<input
									type="date"
									name="snoozedUntil"
									aria-label={t('items.detail.snoozeCustom')}
									value={form?.context === 'snooze' &&
									form.actionId === entry.action.id &&
									form.snoozedUntil &&
									!['TOMORROW', 'THREE_DAYS', 'SEVEN_DAYS'].includes(form.snoozedUntil)
										? form.snoozedUntil
										: ''}
								/>
							</label>
							<button type="submit" class="secondary">{t('items.detail.snoozeCustomSubmit')}</button
							>
							<button type="button" class="link" onclick={closeDialog}>
								{t('common.cancel')}
							</button>
						</form>
					</dialog>
				{/if}
			</span>

			<span
				class="timeline__state"
				class:timeline__state--done={state === 'done'}
				class:timeline__state--now={state === 'now'}
			>
				{stateLabel[state]}
			</span>
		</li>
	{/each}
</ol>
