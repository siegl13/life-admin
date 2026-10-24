<script lang="ts">
	import { t } from '$lib/i18n';
	import type { FieldGroupView } from '$lib/domain/field/fieldGroup';

	let { groups, open = false }: { groups: readonly FieldGroupView[]; open?: boolean } = $props();

	function groupLabel(view: FieldGroupView): string {
		return view.group.label ?? t('items.detail.groupGeneral');
	}

	/** Groups only move inside their own featured or non-featured list. */
	function canMove(index: number, direction: -1 | 1): boolean {
		const featured = groups[index].group.featured;
		return groups[index + direction]?.group.featured === featured;
	}

	let allFields = $derived(groups.flatMap((view) => view.fields.map((field) => ({ field, view }))));
</script>

<details class="disclosure disclosure--quiet field-groups" id="field-groups" {open}>
	<summary>{t('items.detail.manageGroups')}</summary>
	<div class="form-stack">
		<form method="POST" action="?/addFieldGroup" class="form-stack">
			<div class="field-row">
				<label for="new-group-label">{t('items.detail.groupAddHeading')}</label>
				<input id="new-group-label" name="label" type="text" maxlength="80" required />
			</div>
			<div class="form-actions">
				<button type="submit" class="quiet">{t('items.detail.groupAdd')}</button>
			</div>
		</form>

		<ul class="field-groups__list">
			{#each groups as view, index (view.group.id)}
				<li class="field-groups__item">
					<form method="POST" action="?/renameFieldGroup" class="field-groups__rename">
						<input type="hidden" name="groupId" value={view.group.id} />
						<input
							name="label"
							aria-label={t('items.detail.groupRenameFor', { group: groupLabel(view) })}
							type="text"
							maxlength="80"
							required
							value={groupLabel(view)}
						/>
						<button type="submit" class="quiet">{t('items.detail.groupRename')}</button>
					</form>
					<div class="field-groups__controls">
						<form method="POST" action="?/setFieldGroupFeatured">
							<input type="hidden" name="groupId" value={view.group.id} />
							<input type="hidden" name="featured" value={view.group.featured ? 'false' : 'true'} />
							<button type="submit" class="quiet" aria-pressed={view.group.featured}>
								{view.group.featured
									? t('items.detail.groupUnfeature')
									: t('items.detail.groupFeature')}
							</button>
						</form>
						<form method="POST" action="?/moveFieldGroup">
							<input type="hidden" name="groupId" value={view.group.id} />
							<input type="hidden" name="direction" value="up" />
							<button
								type="submit"
								class="quiet"
								disabled={!canMove(index, -1)}
								aria-label={t('items.detail.groupMoveUpFor', { group: groupLabel(view) })}
							>
								{t('items.detail.groupMoveUp')}
							</button>
						</form>
						<form method="POST" action="?/moveFieldGroup">
							<input type="hidden" name="groupId" value={view.group.id} />
							<input type="hidden" name="direction" value="down" />
							<button
								type="submit"
								class="quiet"
								disabled={!canMove(index, 1)}
								aria-label={t('items.detail.groupMoveDownFor', { group: groupLabel(view) })}
							>
								{t('items.detail.groupMoveDown')}
							</button>
						</form>
					</div>
				</li>
			{/each}
		</ul>

		{#if allFields.length > 0}
			<form method="POST" action="?/moveFieldToGroup" class="form-stack">
				<h4 class="field-groups__heading">{t('items.detail.groupMoveFieldHeading')}</h4>
				<div class="field-row">
					<label for="move-field-key">{t('items.detail.groupMoveFieldSelect')}</label>
					<select id="move-field-key" name="fieldKey">
						{#each allFields as { field, view } (field.id)}
							<option value={field.fieldKey}>{field.label} ({groupLabel(view)})</option>
						{/each}
					</select>
				</div>
				<div class="field-row">
					<label for="move-field-group">{t('items.detail.groupMoveTarget')}</label>
					<select id="move-field-group" name="groupId">
						{#each groups as view (view.group.id)}
							<option value={view.group.id}>{groupLabel(view)}</option>
						{/each}
					</select>
				</div>
				<div class="form-actions">
					<button type="submit" class="quiet">{t('items.detail.groupMoveField')}</button>
				</div>
			</form>
		{/if}
	</div>
</details>
