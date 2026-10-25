<script lang="ts">
	import { t } from '$lib/i18n';
	import type { FieldGroup } from '$lib/domain/field/fieldGroup';

	let {
		group,
		label,
		returnTo = 'manager'
	}: { group: FieldGroup; label: string; returnTo?: 'manager' | 'facts' } = $props();
</script>

<!-- A plain POST form, so featuring works without JavaScript. -->
<form method="POST" action="?/setFieldGroupFeatured" class="group-star">
	<input type="hidden" name="groupId" value={group.id} />
	<input type="hidden" name="featured" value={group.featured ? 'false' : 'true'} />
	<input type="hidden" name="returnTo" value={returnTo} />
	<button
		type="submit"
		class="group-star__button"
		aria-pressed={group.featured}
		aria-label={t('items.detail.groupFeatureFor', { group: label })}
	>
		<span aria-hidden="true">{group.featured ? '★' : '☆'}</span>
	</button>
</form>
