<script lang="ts">
	import { t } from '$lib/i18n';
</script>

<details class="disclosure disclosure--quiet fields-panel__add">
	<summary>{t('items.detail.addCustomField')}</summary>
	<form method="POST" action="?/addField" class="form-stack">
		<div class="field-row">
			<label for="new-field-label">{t('items.detail.customFieldLabel')}</label>
			<input id="new-field-label" name="label" type="text" required />
		</div>
		<div class="field-row">
			<label for="new-field-type">{t('items.detail.customFieldType')}</label>
			<select id="new-field-type" name="type">
				<option value="text">{t('items.detail.fieldTypeText')}</option>
				<option value="date">{t('items.detail.fieldTypeDate')}</option>
				<option value="currency">{t('items.detail.fieldTypeCurrency')}</option>
			</select>
		</div>
		<div class="form-actions">
			<button type="submit" class="quiet">{t('items.detail.addCustomField')}</button>
		</div>
	</form>
</details>
