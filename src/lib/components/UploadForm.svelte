<script lang="ts">
	import { formatByteSize } from '$lib/domain/attachment/attachment';
	import { t } from '$lib/i18n';

	let {
		action,
		pickLabel,
		submitLabel,
		accept,
		quiet = false
	}: {
		action: string;
		pickLabel: string;
		submitLabel: string;
		accept?: string;
		quiet?: boolean;
	} = $props();

	type Selection = { name: string; detail: string };

	let selection = $state<Selection | null>(null);
	let uploading = $state(false);

	function typeLabel(file: File): string {
		if (file.type === 'application/pdf') return 'PDF';
		if (file.type.startsWith('image/')) return file.type.slice('image/'.length).toUpperCase();
		return '';
	}

	function describe(file: File): Selection {
		const detail = [typeLabel(file), formatByteSize(file.size)].filter(Boolean).join(' · ');
		return { name: file.name, detail };
	}

	function onchange(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		uploading = false;
		selection = file ? describe(file) : null;
	}

	function onsubmit(event: SubmitEvent) {
		uploading = true;
		const submitter = event.submitter as HTMLButtonElement | null;
		// Disable only after the browser has captured the submission.
		if (submitter) setTimeout(() => (submitter.disabled = true), 0);
	}
</script>

<form
	method="POST"
	{action}
	enctype="multipart/form-data"
	class="upload-form"
	aria-busy={uploading}
	{onsubmit}
>
	<label class="upload-picker button" class:quiet class:upload-picker--selected={selection}>
		{selection ? t('upload.change') : pickLabel}
		<input name="file" type="file" {accept} required {onchange} />
	</label>
	<button class="upload-form__submit" type="submit">{submitLabel}</button>
	{#if selection}
		<p class="upload-summary" class:upload-summary--busy={uploading} role="status">
			<span class="upload-summary__state">
				<span aria-hidden="true">{uploading ? '…' : '✓'}</span>
				{uploading ? t('upload.uploading') : t('upload.selected')}
			</span>
			<span class="upload-summary__name" title={selection.name}>{selection.name}</span>
			{#if selection.detail}<span class="upload-summary__detail">{selection.detail}</span>{/if}
		</p>
	{/if}
</form>
