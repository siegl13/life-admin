<script lang="ts">
	import { resolve } from '$app/paths';
	import { t, resolveLabel } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class="page-head">
	<a class="backlink" href={resolve('/items')}>← {t('nav.items')}</a>
	<h1>{t('items.new.title')}</h1>
	<p>{t('items.new.lead')}</p>
</div>

<!--
	Progressive entry, unchanged: title is the only required input, the
	playbook select defaults to "no playbook", and everything else stays
	behind a clearly optional disclosure.
-->
<form method="POST" class="form-panel">
	<div class="field-row">
		<label for="title">{t('items.new.titleLabel')}</label>
		<input
			id="title"
			name="title"
			type="text"
			value={form?.title ?? ''}
			placeholder={t('items.new.titlePlaceholder')}
			required
			aria-describedby={form?.error === 'title-required' ? 'title-error' : undefined}
		/>
		{#if form?.error === 'title-required'}
			<span class="form-error" id="title-error">{t('items.new.titleRequired')}</span>
		{/if}
	</div>

	<div class="field-row">
		<label for="playbookId">{t('items.new.playbookLabel')}</label>
		<select id="playbookId" name="playbookId">
			<option value="">{t('items.new.noPlaybook')}</option>
			{#each data.playbooks as playbook (playbook.id)}
				<option value={playbook.id}>{resolveLabel(playbook.name, playbook.labelI18n)}</option>
			{/each}
		</select>
		<span class="hint">{t('items.new.playbookHint')}</span>
	</div>

	<div class="form-actions">
		<button type="submit">{t('items.new.submit')}</button>
		<a class="backlink" href={resolve('/items')}>{t('common.cancel')}</a>
	</div>
</form>
