<script lang="ts">
	import { t } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';
	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class="page-head"><h1>{t('auth.login.title')}</h1></div>
{#if form?.failed}<div class="notice">{t('auth.login.failed')}</div>{/if}
{#if form?.lockedMinutes}<div class="notice">
		{t('auth.login.locked', { minutes: String(form.lockedMinutes) })}
	</div>{/if}
<form method="POST" class="form-panel">
	<input type="hidden" name="redirectTo" value={form?.redirectTo ?? data.redirectTo} />
	<div class="field-row">
		<label for="username">{t('auth.login.username')}</label>
		<input id="username" name="username" type="text" autocomplete="username" required />
	</div>
	<div class="field-row">
		<label for="password">{t('auth.login.password')}</label>
		<input id="password" name="password" type="password" autocomplete="current-password" required />
	</div>
	<button type="submit">{t('auth.login.submit')}</button>
</form>
