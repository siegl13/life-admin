<script lang="ts">
	import { t } from '$lib/i18n';
</script>

<!--
	The only entry point for creating a manual action: always scoped to
	one item's detail page, never a top-level "add task" screen. Folded
	into a disclosure so the detail page stays a story, not a form stack.
-->
<details class="disclosure">
	<summary>{t('items.detail.addManualAction')}</summary>
	<form method="POST" action="?/addManualAction" class="form-stack">
		<div class="field-row">
			<label for="manual-action-label">{t('items.detail.manualActionLabel')}</label>
			<input id="manual-action-label" name="label" type="text" required />
		</div>
		<div class="field-row">
			<label for="manual-action-due">
				{t('items.detail.manualActionDueDate')}
				<span class="field-row__optional">({t('common.optional')})</span>
			</label>
			<input id="manual-action-due" name="dueDate" type="date" />
		</div>
		<div class="form-actions">
			<button type="submit" class="quiet">{t('items.detail.addManualAction')}</button>
		</div>
	</form>
</details>
