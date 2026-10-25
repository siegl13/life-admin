<script lang="ts">
	import { t } from '$lib/i18n';
	import type { FieldGroupView } from '$lib/domain/field/fieldGroup';
	import GroupStarToggle from './GroupStarToggle.svelte';

	let { groups, open = false }: { groups: readonly FieldGroupView[]; open?: boolean } = $props();

	function groupLabel(view: FieldGroupView): string {
		return view.group.label ?? t('items.detail.groupGeneral');
	}

	/** Groups only move inside their own featured or non-featured list. */
	function canMove(index: number, direction: -1 | 1): boolean {
		const featured = groups[index].group.featured;
		return groups[index + direction]?.group.featured === featured;
	}
</script>

<details class="disclosure disclosure--quiet field-groups" id="field-groups" {open}>
	<summary>{t('items.detail.manageGroups')}</summary>
	<div class="form-stack">
		<ul class="field-groups__list">
			{#each groups as view, index (view.group.id)}
				<li class="field-groups__row">
					<span class="field-groups__name">{groupLabel(view)}</span>
					<GroupStarToggle group={view.group} label={groupLabel(view)} />
					<details class="group-menu">
						<summary aria-label={t('items.detail.groupMoreFor', { group: groupLabel(view) })}>
							<span aria-hidden="true">⋯</span>
						</summary>
						<div class="group-menu__panel">
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
							{#if canMove(index, -1)}
								<form method="POST" action="?/moveFieldGroup">
									<input type="hidden" name="groupId" value={view.group.id} />
									<input type="hidden" name="direction" value="up" />
									<button
										type="submit"
										class="quiet"
										aria-label={t('items.detail.groupMoveUpFor', { group: groupLabel(view) })}
									>
										{t('items.detail.groupMoveUp')}
									</button>
								</form>
							{/if}
							{#if canMove(index, 1)}
								<form method="POST" action="?/moveFieldGroup">
									<input type="hidden" name="groupId" value={view.group.id} />
									<input type="hidden" name="direction" value="down" />
									<button
										type="submit"
										class="quiet"
										aria-label={t('items.detail.groupMoveDownFor', { group: groupLabel(view) })}
									>
										{t('items.detail.groupMoveDown')}
									</button>
								</form>
							{/if}
						</div>
					</details>
				</li>
			{/each}
		</ul>

		<details class="group-add">
			<summary>{t('items.detail.groupAddOpen')}</summary>
			<form method="POST" action="?/addFieldGroup" class="form-stack">
				<div class="field-row">
					<label for="new-group-label">{t('items.detail.groupAddHeading')}</label>
					<input id="new-group-label" name="label" type="text" maxlength="80" required />
				</div>
				<div class="form-actions">
					<button type="submit" class="quiet">{t('items.detail.groupAdd')}</button>
				</div>
			</form>
		</details>
	</div>
</details>
