import { expect, it } from 'vitest';
import { parseDocumentRouteSuggestion } from './document';

it('drops malformed persisted routing suggestions', () => {
	expect(
		parseDocumentRouteSuggestion({
			documentKind: 'contract',
			suggestedPlaybookId: null,
			suggestedItemIds: [],
			itemMatchingHints: [],
			extra: 'untrusted'
		})
	).toBeNull();
});

it('accepts a bounded normalized routing suggestion', () => {
	expect(
		parseDocumentRouteSuggestion({
			documentKind: 'contract',
			suggestedPlaybookId: 'leasing.contract',
			suggestedItemIds: ['item-1'],
			itemMatchingHints: ['leasing']
		})
	).toEqual({
		documentKind: 'contract',
		suggestedPlaybookId: 'leasing.contract',
		suggestedItemIds: ['item-1'],
		itemMatchingHints: ['leasing']
	});
});
