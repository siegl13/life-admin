<script lang="ts">
	import { t } from '$lib/i18n';
</script>

<form
	method="POST"
	action="?/addAttachment"
	enctype="multipart/form-data"
	class="upload-form-group"
>
	<div class="upload-form">
		<label class="upload-picker button quiet">
			{t('items.detail.attachmentFile')}
			<input name="file" type="file" required />
		</label>
		<button class="upload-form__submit" type="submit">{t('items.detail.attachmentSubmit')}</button>
	</div>
	<p class="hint">{t('items.detail.attachmentHint')}</p>
</form>
