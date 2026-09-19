<script lang="ts">
	import { t, resolveLabel } from '$lib/i18n';
	import type { PageData } from './$types';
	import type { ActionData } from './$types';
	import { resolve } from '$app/paths';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	function relativeTime(value: string): string {
		const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
		if (minutes < 1) return t('settings.notify.justNow');
		return t('settings.notify.minutesAgo', { minutes: String(minutes) });
	}

	function notificationFailureMessage(reason: string): string {
		if (reason === 'not_configured') return t('settings.notify.failureNotConfigured');
		if (reason === 'timeout') return t('settings.notify.failureTimeout');
		if (reason === 'network_error') return t('settings.notify.failureNetwork');
		const httpStatus = /^http_(\d{3})$/.exec(reason);
		if (httpStatus) return t('settings.notify.failureHttpStatus', { status: httpStatus[1] });
		return t('settings.notify.failureUnknown');
	}
</script>

<div class="page-head">
	<h1>{t('nav.settings')}</h1>
	<p>{t('settings.privacyNote')}</p>
	{#if data.ai.enabled}<p>{t('settings.privacyNote.aiException')}</p>{/if}
</div>

<div class="settings-layout">
	<nav class="settings-nav" aria-label={t('settings.sections')}>
		<a href="#g-theme">{t('settings.appearance')}</a>
		<a href="#g-account">{t('settings.account')}</a>
		<a href="#g-data">{t('settings.data')}</a>
		<a href="#g-playbooks">{t('settings.playbooks')}</a>
		<a href="#g-notifications">{t('settings.notify.title')}</a>
		<a href="#g-ai">{t('settings.ai.title')}</a>
	</nav>

	<div class="settings-groups">
		<!-- ---------- Darstellung ---------- -->
		<section class="settings-group" id="g-theme" aria-labelledby="g-theme-label">
			<div class="settings-group__header">
				<h2 id="g-theme-label">{t('settings.appearance')}</h2>
				<span class="meta">{t('settings.appearance.scopeHint')}</span>
			</div>
			<div class="settings-group__body">
				<form
					method="POST"
					action="?/setTheme"
					class="theme-options"
					role="group"
					aria-label={t('settings.appearance')}
				>
					<button
						type="submit"
						name="theme"
						value="light"
						class="theme-option"
						aria-pressed={data.theme === 'light'}
					>
						{t('settings.appearance.light')}
					</button>
					<button
						type="submit"
						name="theme"
						value="dark"
						class="theme-option"
						aria-pressed={data.theme === 'dark'}
					>
						{t('settings.appearance.dark')}
					</button>
					<button
						type="submit"
						name="theme"
						value="system"
						class="theme-option"
						aria-pressed={data.theme === 'system'}
					>
						{t('settings.appearance.system')}
					</button>
				</form>
				<span class="hint">{t('settings.appearance.appliedHint')}</span>
			</div>
		</section>

		<!-- ---------- Konto ---------- -->
		<section class="settings-group" id="g-account" aria-labelledby="g-account-label">
			<div class="settings-group__header">
				<h2 id="g-account-label">{t('settings.account')}</h2>
				<span class="meta">{t('settings.account.scopeHint')}</span>
			</div>
			<div class="settings-group__body">
				<details class="disclosure disclosure--quiet" open={!!form?.passwordError}>
					<summary>{t('auth.password.submit')}</summary>
					{#if form?.passwordError}<div class="notice notice--error">
							{t('auth.password.failed')}
						</div>{/if}
					<form method="POST" action="?/changePassword" class="form-stack">
						<div class="field-row">
							<label for="current">{t('auth.password.current')}</label>
							<input
								id="current"
								name="current"
								type="password"
								autocomplete="current-password"
								required
							/>
						</div>
						<div class="field-row">
							<label for="new-password">{t('auth.password.new')}</label>
							<input
								id="new-password"
								name="password"
								type="password"
								autocomplete="new-password"
								required
							/>
						</div>
						<div class="field-row">
							<label for="password-confirmation">{t('auth.password.confirm')}</label>
							<input
								id="password-confirmation"
								name="confirmation"
								type="password"
								autocomplete="new-password"
								required
							/>
						</div>
						<div class="form-actions">
							<button type="submit">{t('auth.password.submit')}</button>
							<span class="hint">{t('settings.account.otherSessionsNote')}</span>
						</div>
					</form>
				</details>
			</div>
		</section>

		<!-- ---------- Daten & Backup ---------- -->
		<section class="settings-group" id="g-data" aria-labelledby="g-data-label">
			<div class="settings-group__header">
				<h2 id="g-data-label">{t('settings.data')}</h2>
			</div>
			<div class="settings-group__body">
				<p>
					<a class="button quiet" href={resolve('/settings/backup')}
						>{t('settings.backup.download')}</a
					>
				</p>
				<p class="hint">{t('settings.backup.hint')}</p>

				<details class="disclosure disclosure--quiet" open={!!form?.restoreError}>
					<summary>{t('settings.restore.title')}</summary>
					<div class="form-stack">
						<div class="notice">
							<span class="notice__title">{t('settings.restore.warningTitle')}</span>
							<span class="notice__body">{t('settings.restore.warningBody')}</span>
						</div>
						{#if form?.restoreError}<div class="notice notice--error">
								{t(form.restoreErrorKey ?? 'settings.restore.error.unknown')}
							</div>{/if}
						<form method="POST" action="?/restore" enctype="multipart/form-data" class="form-stack">
							<div class="field-row">
								<label for="backup">{t('settings.restore.file')}</label>
								<input
									id="backup"
									name="backup"
									type="file"
									accept=".zip,application/zip"
									required
								/>
							</div>
							<label class="checkbox-row">
								<input name="confirm" type="checkbox" value="yes" required />
								{t('settings.restore.confirm')}
							</label>
							<button type="submit" class="danger">{t('settings.restore.submit')}</button>
						</form>
					</div>
				</details>
			</div>
		</section>

		<!-- ---------- Vorlagen ---------- -->
		<section class="settings-group" id="g-playbooks" aria-labelledby="g-playbooks-label">
			<div class="settings-group__header">
				<h2 id="g-playbooks-label">{t('settings.playbooks')}</h2>
			</div>
			<div class="settings-group__body">
				{#if form?.playbookError}
					<div class="notice notice--error" role="alert">
						{t(
							form.playbookError === 'future_schema'
								? 'settings.playbooks.errNeedsNewerApp'
								: form.playbookError === 'bundled'
									? 'settings.playbooks.errAlreadyBundled'
									: form.playbookError === 'installed'
										? 'settings.playbooks.errAlreadyInstalled'
										: form.playbookError === 'too_large'
											? 'settings.playbooks.errTooLarge'
											: form.playbookError === 'too_many'
												? 'settings.playbooks.errTooMany'
												: form.playbookError === 'source'
													? 'settings.playbooks.errSource'
													: 'settings.playbooks.errInvalid'
						)}
						{#if form.playbookExistingVersion && form.playbookSubmittedVersion}
							<p>
								{t('settings.playbooks.replaceVersions', {
									existing: form.playbookExistingVersion,
									submitted: form.playbookSubmittedVersion
								})}
							</p>
						{/if}
						{#if form.playbookReasons?.length}
							<ul>
								{#each form.playbookReasons as reason, index (`${index}-${reason}`)}
									<li>{reason}</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}
				<div class="data-list">
					{#each data.playbooks as playbook (playbook.id)}
						<div class="data-row" id={`g-playbook-${playbook.id}`}>
							<span class="data-row__value">{resolveLabel(playbook.name, playbook.labelI18n)}</span>
							<span class="meta">
								{playbook.source === 'bundled'
									? t('settings.sourceBundled')
									: t('settings.sourceCustom')}
								· {t('settings.version')}
								{playbook.version}
								· {t('settings.playbooks.fieldCount', { count: String(playbook.fieldCount) })}
								· {t('settings.playbooks.actionCount', { count: String(playbook.actionCount) })}
							</span>
							{#if playbook.source === 'custom' && playbook.managed}
								<form method="POST" action="?/uninstallPlaybook">
									<input type="hidden" name="playbookId" value={playbook.id} />
									<button type="submit" class="link">{t('settings.playbooks.remove')}</button>
								</form>
							{/if}
						</div>
					{/each}
				</div>
				<p class="hint">{t('settings.playbooks.removeHint')}</p>
				<details class="disclosure disclosure--quiet" open={!!form?.playbookError}>
					<summary>{t('settings.playbooks.add')}</summary>
					<form
						method="POST"
						action="?/installPlaybook"
						enctype="multipart/form-data"
						class="form-stack"
					>
						<div class="field-row">
							<label for="playbook-yaml">{t('settings.playbooks.addYaml')}</label>
							<textarea id="playbook-yaml" name="yaml" rows="8"></textarea>
						</div>
						<div class="field-row">
							<label for="playbook-file">{t('settings.playbooks.addFile')}</label>
							<input
								id="playbook-file"
								name="file"
								type="file"
								accept=".yaml,application/x-yaml,text/yaml"
							/>
						</div>
						<label class="checkbox-row"
							><input name="replace" type="checkbox" value="yes" />{t(
								'settings.playbooks.replaceConfirm'
							)}</label
						>
						<p class="hint">{t('settings.playbooks.installHint')}</p>
						<button type="submit">{t('settings.playbooks.addSubmit')}</button>
					</form>
				</details>
			</div>
		</section>

		<!-- ---------- Dokumenterkennung ---------- -->
		<section class="settings-group" id="g-notifications" aria-labelledby="g-notifications-label">
			<div class="settings-group__header">
				<h2 id="g-notifications-label">{t('settings.notify.title')}</h2>
				<span
					class:settings-group__state--on={data.notifications.enabled}
					class="settings-group__state"
					>{data.notifications.enabled
						? t('settings.notify.stateOn')
						: t('settings.notify.stateOff')}</span
				>
			</div>
			<div class="settings-group__body">
				<p class="hint">{t('settings.notify.explain3')}</p>
				{#if data.notifications.saved}<div class="notice">{t('settings.notify.saved')}</div>{/if}
				{#if data.notifications.testSent}<div class="notice">
						{t('settings.notify.testOk')}
					</div>{/if}
				{#if form?.notificationError}<div class="notice notice--error">
						{form.notificationError === 'settings.notify.invalidServer'
							? t('settings.notify.invalidServer')
							: form.notificationError === 'settings.notify.invalidTopic'
								? t('settings.notify.invalidTopic')
								: form.notificationError === 'settings.notify.invalidWebhook'
									? t('settings.notify.invalidWebhook')
									: t('settings.notify.invalidLeadDays')}
					</div>{/if}
				{#if form?.notificationTestError}<div class="notice notice--error">
						{t('settings.notify.testFailed')}: {notificationFailureMessage(
							form.notificationTestError
						)}
					</div>{/if}
				{#if data.notifications.lastFailure}<div class="notice notice--error">
						{t('settings.notify.lastError', {
							time: relativeTime(data.notifications.lastFailure.failedAt)
						})}: {notificationFailureMessage(data.notifications.lastFailure.reason)}
					</div>{/if}
				<div class="data-list notification-channels">
					<details
						class="disclosure disclosure--quiet notification-channel"
						id="notify-channel-ntfy"
						open={form?.notificationChannel === 'NTFY'}
					>
						<summary>
							<span class="notification-channel__name">{t('settings.notify.ntfy')}</span>
							<span
								class="settings-group__state notification-channel__state"
								class:settings-group__state--on={data.notifications.enabled &&
									data.notifications.channel === 'NTFY' &&
									Boolean(data.notifications.topic)}
							>
								{data.notifications.enabled &&
								data.notifications.channel === 'NTFY' &&
								data.notifications.topic
									? t('settings.notify.channelActive')
									: data.notifications.topic
										? t('settings.notify.channelConfiguredOff')
										: t('settings.notify.channelNotConfigured')}
							</span>
							<span class="notification-channel__action"
								>{data.notifications.topic
									? t('settings.notify.edit')
									: t('settings.notify.setup')}</span
							>
						</summary>
						<form method="POST" action="?/saveNotifications" class="form-stack" novalidate>
							<input type="hidden" name="channel" value="NTFY" />
							<div class="field-row">
								<label for="notify-ntfy-server">{t('settings.notify.server')}</label>
								<input
									id="notify-ntfy-server"
									name="baseUrl"
									type="url"
									value={data.notifications.baseUrl}
								/>
							</div>
							<div class="field-row">
								<label for="notify-ntfy-topic">{t('settings.notify.topic')}</label>
								<input id="notify-ntfy-topic" name="topic" value={data.notifications.topic} />
								<span class="hint">{t('settings.notify.topicWarning')}</span>
							</div>
							<div class="field-row">
								<div class="field-row__head">
									<label for="notify-ntfy-token">{t('settings.notify.token')}</label>
									<span class="field-row__optional">{t('settings.notify.tokenOptional')}</span>
								</div>
								<input id="notify-ntfy-token" name="token" type="password" autocomplete="off" />
								{#if data.notifications.tokenSet}<span class="hint"
										>{t('settings.notify.tokenSet')}</span
									><label class="checkbox-row"
										><input name="removeToken" type="checkbox" value="yes" />
										{t('settings.notify.tokenClear')}</label
									>{/if}
							</div>
							<div class="field-row">
								<label for="notify-ntfy-lead-days">{t('settings.notify.leadDays')}</label>
								<input
									id="notify-ntfy-lead-days"
									name="leadDays"
									type="number"
									min="0"
									max="90"
									value={data.notifications.leadDays}
								/>
								<span class="hint">{t('settings.notify.leadDaysHint')}</span>
							</div>
							<label class="checkbox-row"
								><input
									name="minimalContent"
									type="checkbox"
									value="yes"
									checked={data.notifications.minimalContent}
								/>
								{t('settings.notify.minimal')}</label
							>
							<span class="hint">{t('settings.notify.minimalHint')}</span>
							<label class="checkbox-row"
								><input
									name="enabled"
									type="checkbox"
									value="yes"
									checked={data.notifications.enabled}
								/>
								{t('settings.notify.enabled')}</label
							>
							<div class="form-actions notification-channel__actions">
								<button type="submit">{t('items.detail.save')}</button>
								<button type="submit" formaction="?/testNotification" class="link">
									{t('settings.notify.test')}
								</button>
								{#if data.notifications.lastTickAt}<span class="meta"
										>{t('settings.notify.lastTick', {
											time: relativeTime(data.notifications.lastTickAt)
										})}</span
									>{/if}
							</div>
						</form>
					</details>
					<details
						class="disclosure disclosure--quiet notification-channel"
						id="notify-channel-slack"
						open={form?.notificationChannel === 'SLACK'}
					>
						<summary>
							<span class="notification-channel__name">{t('settings.notify.slack')}</span>
							<span
								class="settings-group__state notification-channel__state"
								class:settings-group__state--on={data.notifications.enabled &&
									data.notifications.channel === 'SLACK' &&
									data.notifications.webhookSet}
							>
								{data.notifications.enabled &&
								data.notifications.channel === 'SLACK' &&
								data.notifications.webhookSet
									? t('settings.notify.channelActive')
									: data.notifications.webhookSet
										? t('settings.notify.channelConfiguredOff')
										: t('settings.notify.channelNotConfigured')}
							</span>
							<span class="notification-channel__action"
								>{data.notifications.webhookSet
									? t('settings.notify.edit')
									: t('settings.notify.setup')}</span
							>
						</summary>
						<form method="POST" action="?/saveNotifications" class="form-stack" novalidate>
							<input type="hidden" name="channel" value="SLACK" />
							<input type="hidden" name="baseUrl" value={data.notifications.baseUrl} />
							<input type="hidden" name="topic" value={data.notifications.topic} />
							<div class="field-row">
								<label for="notify-slack-webhook">{t('settings.notify.webhookUrl')}</label>
								<input
									id="notify-slack-webhook"
									name="webhookUrl"
									type="password"
									autocomplete="off"
								/>
								{#if data.notifications.webhookSet}<span class="hint"
										>{t('settings.notify.webhookSet')}</span
									><label class="checkbox-row"
										><input name="removeWebhook" type="checkbox" value="yes" />
										{t('settings.notify.webhookClear')}</label
									>{/if}
							</div>
							<div class="field-row">
								<label for="notify-slack-lead-days">{t('settings.notify.leadDays')}</label>
								<input
									id="notify-slack-lead-days"
									name="leadDays"
									type="number"
									min="0"
									max="90"
									value={data.notifications.leadDays}
								/>
								<span class="hint">{t('settings.notify.leadDaysHint')}</span>
							</div>
							<label class="checkbox-row"
								><input
									name="minimalContent"
									type="checkbox"
									value="yes"
									checked={data.notifications.minimalContent}
								/>
								{t('settings.notify.minimal')}</label
							>
							<span class="hint">{t('settings.notify.minimalHint')}</span>
							<label class="checkbox-row"
								><input
									name="enabled"
									type="checkbox"
									value="yes"
									checked={data.notifications.enabled}
								/>
								{t('settings.notify.enabled')}</label
							>
							<div class="form-actions notification-channel__actions">
								<button type="submit">{t('items.detail.save')}</button>
								<button type="submit" formaction="?/testNotification" class="link">
									{t('settings.notify.test')}
								</button>
								{#if data.notifications.lastTickAt}<span class="meta"
										>{t('settings.notify.lastTick', {
											time: relativeTime(data.notifications.lastTickAt)
										})}</span
									>{/if}
							</div>
						</form>
					</details>
				</div>
			</div>
		</section>

		<!-- ---------- Dokumenterkennung ---------- -->
		<section class="settings-group" id="g-ai" aria-labelledby="g-ai-label">
			<div class="settings-group__header">
				<h2 id="g-ai-label">{t('settings.ai.title')}</h2>
				<span class="settings-group__state" class:settings-group__state--on={data.ai.enabled}>
					{data.ai.enabled ? t('settings.ai.stateOn') : t('settings.ai.stateOff')}
				</span>
			</div>
			<div class="settings-group__body">
				<p class="note-text">{t('settings.ai.explain1')}</p>

				<div class="info-box">
					<div class="info-box__row">
						<span class="info-box__label info-box__label--positive"
							>{t('settings.ai.onlyLabel')}</span
						>
						<span>{t('settings.ai.onlyBody')}</span>
					</div>
					<div class="info-box__row">
						<span class="info-box__label">{t('settings.ai.neverLabel')}</span>
						<span>{t('settings.ai.neverBody')}</span>
					</div>
				</div>

				<span class="hint">{t('settings.ai.noAutoSave')}</span>

				{#if form?.aiError}
					<div class="notice notice--error">
						{t(form.aiErrorKey ?? 'settings.ai.consentRequired')}
					</div>
				{/if}
				{#if !data.ai.keyPresent}
					<p class="hint">{t('settings.ai.keyMissing')}</p>
				{/if}

				{#if data.ai.enabled}
					<div class="form-actions">
						<form method="POST" action="?/disableAi">
							<button type="submit" class="secondary">{t('settings.ai.disable')}</button>
						</form>
						<span class="hint">{t('settings.ai.offlineAfterDisable')}</span>
					</div>

					<details class="disclosure disclosure--quiet">
						<summary>{t('settings.ai.instruction')}</summary>
						<form method="POST" action="?/saveAiInstruction" class="form-stack">
							<div class="field-row">
								<label for="ai-instruction">{t('settings.ai.instruction')}</label>
								<textarea id="ai-instruction" name="instruction" maxlength="1000" rows="4"
									>{data.ai.instruction}</textarea
								>
							</div>
							<p class="hint">{t('settings.ai.instructionHint')}</p>
							<div class="form-actions">
								<button type="submit">{t('items.detail.save')}</button>
								<button type="submit" formaction="?/restoreAiInstruction" class="secondary">
									{t('settings.ai.restoreDefault')}
								</button>
							</div>
						</form>
					</details>
				{:else}
					<form method="POST" action="?/enableAi" class="form-stack">
						<label class="checkbox-row">
							<input name="consent" type="checkbox" value="yes" required />
							{t('settings.ai.consent')}
						</label>
						<div class="form-actions">
							<button type="submit" disabled={!data.ai.keyPresent}>{t('settings.ai.enable')}</button
							>
							<span class="hint">{t('settings.ai.canDisableAnytime')}</span>
						</div>
					</form>
				{/if}
			</div>
		</section>
	</div>
</div>

{#if data.errors.length > 0}
	<section class="section" aria-labelledby="errors-label">
		<h2 class="section__label" id="errors-label">{t('settings.technical')}</h2>
		{#each data.errors as err, i (i)}
			<div class="notice">
				<span class="notice__title">{t('settings.playbookNotLoaded')}</span>
				<span class="notice__body">{err.filePath} — {err.reason} ({err.source})</span>
			</div>
		{/each}
		<p class="hint">{t('settings.playbookNotLoadedHint')}</p>
	</section>
{/if}
