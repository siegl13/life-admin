<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatDate } from '$lib/ui/format';
	import { effectiveDueDate } from '$lib/domain/action/action';
	import type { WorkflowAction } from '$lib/application/items/getItemWorkflow';
	import type { NotificationSnooze } from '$lib/domain/notify/snooze';

	let {
		workflow,
		snoozes = {},
		today,
		readOnly = false
	}: {
		workflow: readonly WorkflowAction[];
		snoozes?: Record<string, NotificationSnooze | null>;
		today: string;
		readOnly?: boolean;
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
					<span class="hint">{t('items.detail.status.nowHint')}</span>
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

				{#if canEditDueDate(entry)}
					{#if effectiveDueDate(entry.action)}
						<span class="meta">
							{t('whatsNext.dueOn')}
							{formatDate(effectiveDueDate(entry.action)!)}
						</span>
					{/if}
					{#if entry.action.dueOverrideDate}
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
					{#if !readOnly}
						<details class="disclosure disclosure--quiet timeline__due-disclosure">
							<summary>{t('items.detail.changeDueDate')}</summary>
							<form method="POST" action="?/setActionDueOverride" class="form-stack">
								<input type="hidden" name="actionId" value={entry.action.id} />
								<div class="field-row">
									<label for="due-date-{entry.action.id}">{t('items.detail.dueDateLabel')}</label>
									<input
										id="due-date-{entry.action.id}"
										name="dueDate"
										type="date"
										value={entry.action.dueOverrideDate ?? entry.action.dueDate ?? ''}
									/>
								</div>
								<div class="form-actions">
									<button type="submit" class="quiet">
										{t('items.detail.saveDueDate')}
									</button>
								</div>
							</form>
						</details>
					{/if}
				{/if}
				{#if canSnooze(entry) && !readOnly}
					<div class="snooze">
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
							<span class="meta">{t('items.detail.snoozeReplace')}</span>
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
									/>
								</label>
								<button type="submit" class="secondary"
									>{t('items.detail.snoozeCustomSubmit')}</button
								>
							</form>
						{:else}
							<span class="meta">{t('items.detail.snooze')}</span>
							<form method="POST" action="?/setSnooze" class="snooze__form">
								<input type="hidden" name="actionId" value={entry.action.id} />
								<button type="submit" name="snoozedUntil" value="TOMORROW" class="secondary"
									>{t('items.detail.snoozeTomorrow')}</button
								>
								<button type="submit" name="snoozedUntil" value="THREE_DAYS" class="secondary"
									>{t('items.detail.snoozeThreeDays')}</button
								>
								<button type="submit" name="snoozedUntil" value="SEVEN_DAYS" class="secondary"
									>{t('items.detail.snoozeSevenDays')}</button
								>
								<label>
									<span class="sr-only">{t('items.detail.snoozeCustom')}</span>
									<input
										type="date"
										name="snoozedUntil"
										aria-label={t('items.detail.snoozeCustom')}
									/>
								</label>
								<button type="submit" class="secondary"
									>{t('items.detail.snoozeCustomSubmit')}</button
								>
							</form>
						{/if}
					</div>
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
