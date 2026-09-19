<script lang="ts">
	import { t } from '$lib/i18n';
	import type { ActionData } from './$types';
	let { form }: { form: ActionData } = $props();
</script>

<div class="page-head">
	<h1>{t('auth.setup.title')}</h1>
	<p>{t('auth.setup.lead')}</p>
</div>
{#if form?.error}<div class="notice">{t('auth.setup.failed')}</div>{/if}
<form method="POST" class="form-panel">
	<div class="field-row">
		<label for="username">{t('auth.login.username')}</label>
		<input id="username" name="username" type="text" autocomplete="username" required />
	</div>
	<div class="field-row">
		<label for="password">{t('auth.login.password')}</label>
		<input id="password" name="password" type="password" autocomplete="new-password" required />
	</div>
	<div class="field-row">
		<label for="confirmation">{t('auth.setup.confirm')}</label>
		<input
			id="confirmation"
			name="confirmation"
			type="password"
			autocomplete="new-password"
			required
		/>
	</div>
	<button type="submit">{t('auth.setup.submit')}</button>
</form>
