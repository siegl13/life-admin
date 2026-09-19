<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import type { RelationCandidate, RelatedItem } from '$lib/application/ports';

	let {
		itemId,
		relatedItems,
		candidates,
		query,
		manage,
		archived
	}: {
		itemId: string;
		relatedItems: RelatedItem[];
		candidates: RelationCandidate[];
		query: string;
		manage: boolean;
		archived: boolean;
	} = $props();

	function titleParts(title: string): { before: string; match: string; after: string } {
		if (!query) return { before: title, match: '', after: '' };
		let normalized = '';
		const starts: number[] = [];
		const ends: number[] = [];
		let previousWasWhitespace = false;
		const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(title);
		for (const { segment, index } of segments) {
			const whitespace = /^\s+$/u.test(segment);
			if (whitespace && previousWasWhitespace) {
				ends[ends.length - 1] = index + segment.length;
				continue;
			}
			const piece = whitespace ? ' ' : segment.normalize('NFKC').toLowerCase();
			normalized += piece;
			for (let offset = 0; offset < piece.length; offset += 1) {
				starts.push(index);
				ends.push(index + segment.length);
			}
			previousWasWhitespace = whitespace;
		}
		const start = normalized.indexOf(query);
		if (start < 0) return { before: title, match: '', after: '' };
		const originalStart = starts[start];
		const originalEnd = ends[start + query.length - 1];
		return {
			before: title.slice(0, originalStart),
			match: title.slice(originalStart, originalEnd),
			after: title.slice(originalEnd)
		};
	}
</script>

{#snippet linkedList(items: RelatedItem[])}
	<div class="related-list">
		{#each items as related (related.id)}
			<a class="related-row" href={resolve('/items/[id]', { id: related.id })}>
				<span class="related-row__text">
					<span class="related-row__title">{related.title}</span>
					{#if related.playbookName}<span class="related-row__meta">{related.playbookName}</span
						>{/if}
				</span>
				<span class="related-row__arrow" aria-hidden="true">→</span>
			</a>
		{/each}
	</div>
{/snippet}

{#snippet linkedListWithDisclosure(items: RelatedItem[])}
	{#if items.length <= 5}
		{@render linkedList(items)}
	{:else}
		{@render linkedList(items.slice(0, 5))}
		<details class="related-more">
			<summary>{t('items.detail.relationsShowAll', { count: String(items.length) })}</summary>
			{@render linkedList(items.slice(5))}
		</details>
	{/if}
{/snippet}

{#snippet emptyState(inManageMode: boolean)}
	<div class="relations-empty-head">
		{#if inManageMode}
			<h3 class="section__label">{t('items.detail.relations')}</h3>
		{:else}
			<h2 class="section__label" id="relations-label">{t('items.detail.relations')}</h2>
		{/if}
		<a href={resolve('/items/[id]?manage=relations#relations', { id: itemId })}
			>{t('items.detail.relationsAdd')}</a
		>
	</div>
	<p class="hint">{t('items.detail.relationsEmpty')}</p>
{/snippet}

<section class="section" id="relations" aria-labelledby="relations-label">
	{#if archived}
		<h2 class="section__label" id="relations-label">{t('items.detail.relations')}</h2>
		{@render linkedListWithDisclosure(relatedItems)}
	{:else if relatedItems.length === 0 && !manage}
		{@render emptyState(false)}
	{:else}
		<details class="fields-panel" open={manage}>
			<summary>
				<h2 class="fields-panel__title" id="relations-label">{t('items.detail.relations')}</h2>
				<span class="fields-panel__enter">{t('items.detail.relationsManage')}</span>
				<span class="fields-panel__active">
					<span class="fields-panel__active-label">
						<span class="fields-panel__dot" aria-hidden="true"></span>
						{t('items.detail.relationsManageActive')}
					</span>
					<span class="fields-panel__done">{t('items.detail.relationsManageDone')}</span>
				</span>
			</summary>

			{#if relatedItems.length > 0}
				<div class="related-list related-list--manage">
					{#each relatedItems as related (related.id)}
						<div class="related-manage-row">
							<span class="related-row__text">
								<span class="related-row__title">{related.title}</span>
								{#if related.playbookName}<span class="related-row__meta"
										>{related.playbookName}</span
									>{/if}
							</span>
							<form method="POST" action="?/unlinkItem">
								<input type="hidden" name="relatedItemId" value={related.id} />
								<input type="hidden" name="q" value={query} />
								<button type="submit" class="relation-unlink"
									>{t('items.detail.relationsUnlink')}</button
								>
							</form>
						</div>
					{/each}
					<p class="related-list__hint">{t('items.detail.relationsUnlinkHint')}</p>
				</div>
			{/if}

			<details class="disclosure disclosure--quiet relation-add" open={manage}>
				<summary>{t('items.detail.relationsAdd')}</summary>
				<form method="GET" class="relation-search">
					<input type="hidden" name="manage" value="relations" />
					<label for="relation-query" class="section__label"
						>{t('items.detail.relationsSearch')}</label
					>
					<div class="relation-search__controls">
						<input
							id="relation-query"
							name="q"
							type="search"
							value={query}
							placeholder={t('items.detail.relationsSearch')}
						/>
						<button type="submit" class="secondary"
							>{t('items.detail.relationsSearchSubmit')}</button
						>
					</div>
				</form>

				{#if candidates.length === 0}
					<p class="hint">{t('items.detail.relationsNoResult')}</p>
				{:else}
					<div class="related-list relation-candidates">
						{#each candidates as candidate (candidate.id)}
							{@const parts = titleParts(candidate.title)}
							<div
								class:relation-candidate--linked={candidate.alreadyLinked}
								class="related-manage-row"
							>
								<span class="related-row__text">
									<span class="related-row__title"
										>{parts.before}{#if parts.match}<mark>{parts.match}</mark
											>{/if}{parts.after}</span
									>
									{#if candidate.playbookName}<span class="related-row__meta"
											>{candidate.playbookName}</span
										>{/if}
								</span>
								{#if candidate.alreadyLinked}
									<span class="hint">{t('items.detail.relationsAlreadyLinked')}</span>
								{:else}
									<form method="POST" action="?/linkItem">
										<input type="hidden" name="relatedItemId" value={candidate.id} />
										<input type="hidden" name="q" value={query} />
										<button type="submit">{t('items.detail.relationsLink')}</button>
									</form>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</details>
		</details>

		<div class="fields-view">
			{#if relatedItems.length === 0}
				{@render emptyState(true)}
			{:else}
				{@render linkedListWithDisclosure(relatedItems)}
			{/if}
		</div>
	{/if}
</section>
