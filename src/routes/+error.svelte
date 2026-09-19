<script lang="ts">
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
</script>

<div class="page-head"><h1>{page.error?.message ?? t('errors.generic')}</h1></div>
{#if page.error?.errorId}<p>{t('errors.reference', { id: page.error.errorId })}</p>{/if}
