import { expect, it } from 'vitest';
import { normalizeRoutingSuggestion, restrictRoutingSuggestion } from './routing';

it('drops unknown playbooks and bounds hostile routing hints', () => {
	const suggestion = normalizeRoutingSuggestion(
		{
			documentKind: 'leasing',
			playbookMatchingHints: ['Unknown workflow'],
			itemMatchingHints: ['car', 'car', '', 'x'.repeat(81), 'contract']
		},
		[{ id: 'known', name: 'Known workflow', labelI18n: {} }],
		[{ id: 'item-1', title: 'Car contract' }]
	);
	expect(suggestion).toEqual({
		documentKind: 'leasing',
		suggestedPlaybookId: null,
		suggestedItemIds: ['item-1'],
		itemMatchingHints: ['car', 'contract']
	});
});

it('matches provider hints to installed Playbook names and localized labels', () => {
	expect(
		normalizeRoutingSuggestion(
			{
				documentKind: 'contract',
				playbookMatchingHints: ['Stromvertrag'],
				itemMatchingHints: []
			},
			[
				{
					id: 'de.contract.electricity',
					name: 'Electricity contract',
					labelI18n: { de: 'Stromvertrag' }
				}
			]
		)
	).toMatchObject({ suggestedPlaybookId: 'de.contract.electricity' });
});

it('matches a descriptive provider hint without exposing a custom Playbook name', () => {
	expect(
		normalizeRoutingSuggestion(
			{
				documentKind: 'insurance',
				playbookMatchingHints: ['Pet insurance renewal'],
				itemMatchingHints: []
			},
			[
				{
					id: 'private.custom.id',
					name: 'Pet insurance renewal workflow',
					labelI18n: {}
				}
			]
		)
	).toMatchObject({ suggestedPlaybookId: 'private.custom.id' });
});

it('declines to suggest a Playbook when a hint matches more than one installed candidate', () => {
	expect(
		normalizeRoutingSuggestion(
			{
				documentKind: 'insurance',
				playbookMatchingHints: ['Insurance renewal'],
				itemMatchingHints: []
			},
			[
				{ id: 'home-insurance', name: 'Home insurance renewal', labelI18n: {} },
				{ id: 'pet-insurance', name: 'Pet insurance renewal', labelI18n: {} }
			]
		)
	).toMatchObject({ suggestedPlaybookId: null });
});

it('removes stale local ids from a stored suggestion', () => {
	expect(
		restrictRoutingSuggestion(
			{
				documentKind: 'contract',
				suggestedPlaybookId: 'removed',
				suggestedItemIds: ['known-item', 'removed-item'],
				itemMatchingHints: []
			},
			['known-playbook'],
			['known-item']
		)
	).toMatchObject({ suggestedPlaybookId: null, suggestedItemIds: ['known-item'] });
});
