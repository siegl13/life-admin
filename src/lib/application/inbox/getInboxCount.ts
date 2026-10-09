import type { InboxRepositoryPort } from '../ports';

/** The What's next side panel's only Inbox read: a count, not the documents
 *  themselves, so it stays a single lightweight call over the existing port. */
export function getInboxCount(ports: { inbox: InboxRepositoryPort }): number {
	return ports.inbox.listPending().length;
}
