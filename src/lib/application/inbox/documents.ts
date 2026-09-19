import {
	detectAttachmentMimeType,
	MAX_ATTACHMENT_BYTES,
	sanitizeFilename
} from '$lib/domain/attachment/attachment';
import type { InboxDocument } from '$lib/domain/inbox/document';
import { prepareCreateItemInput } from '../items/createItem';
import { getAiSettings } from '../ai/aiSettings';
import { normalizeRoutingSuggestion, type DocumentRoutingProviderPort } from '../ai/routing';
import { DailyInboxAiLimitReachedError } from '../ports';
import type { AppSettingsPort } from '../ai/ports';
import type {
	AttachmentStoragePort,
	Clock,
	IdGeneratorPort,
	InboxRepositoryPort,
	InboxAiRunRepositoryPort,
	InboxStoragePort,
	ItemRepositoryPort,
	PlaybookCatalogPort
} from '../ports';

export class InboxDocumentRejectedError extends Error {}
export class InboxDocumentNotAvailableError extends Error {}

function readVerifiedPendingDocument(
	storage: InboxStoragePort,
	document: InboxDocument,
	maxBytes: number
): Uint8Array {
	let bytes: Uint8Array;
	try {
		bytes = storage.readBytes(document.storageKey, maxBytes);
	} catch {
		throw new InboxDocumentRejectedError('UNREADABLE');
	}
	if (
		bytes.byteLength !== document.byteSize ||
		storage.sha256(bytes) !== document.sha256 ||
		detectAttachmentMimeType(bytes.subarray(0, 16)) !== document.mimeType
	) {
		throw new InboxDocumentRejectedError('INTEGRITY');
	}
	return bytes;
}

type InboxPorts = {
	inbox: InboxRepositoryPort;
	storage: InboxStoragePort;
	ids: IdGeneratorPort;
	clock: Clock;
};

export function uploadInboxDocument(
	ports: InboxPorts,
	input: { filename: string; bytes: Uint8Array }
): InboxDocument {
	if (!input.bytes.byteLength) throw new InboxDocumentRejectedError('EMPTY');
	if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES)
		throw new InboxDocumentRejectedError('TOO_LARGE');
	const mimeType = detectAttachmentMimeType(input.bytes.subarray(0, 16));
	if (!mimeType) throw new InboxDocumentRejectedError('TYPE');
	const id = ports.ids.newId();
	const storageKey = ports.storage.store(id, input.bytes);
	const now = ports.clock.nowIso();
	try {
		return ports.inbox.insert({
			id,
			storageKey,
			filename: sanitizeFilename(input.filename),
			mimeType,
			byteSize: input.bytes.byteLength,
			sha256: ports.storage.sha256(input.bytes),
			suggestion: null,
			status: 'PENDING',
			createdAt: now,
			updatedAt: now
		});
	} catch (cause) {
		ports.storage.remove(storageKey);
		throw cause;
	}
}

type RoutePorts = InboxPorts & {
	attachmentStorage: AttachmentStoragePort;
	playbooks: PlaybookCatalogPort;
};

export type InboxRouteInput =
	| { documentId: string; destination: 'EXISTING'; itemId: string }
	| { documentId: string; destination: 'GENERIC'; newItemTitle: string }
	| { documentId: string; destination: 'PLAYBOOK'; newItemTitle: string; playbookId: string };

/** Claims the pending row first. A concurrent second confirmation cannot get
 * past that claim, and any later failure releases the original document. */
export function routeInboxDocument(
	ports: RoutePorts,
	input: InboxRouteInput
): { itemId: string; attachmentId: string } {
	const pending = ports.inbox.claimForRouting(input.documentId, ports.clock.nowIso());
	if (!pending) throw new InboxDocumentNotAvailableError();
	try {
		const bytes = readVerifiedPendingDocument(ports.storage, pending, MAX_ATTACHMENT_BYTES);
		const attachmentId = ports.ids.newId();
		const attachmentStorageKey = ports.attachmentStorage.store(attachmentId, bytes);
		let completed: { itemId: string; attachmentId: string } | null;
		try {
			completed = ports.inbox.completeRouting({
				documentId: pending.id,
				destination:
					input.destination === 'EXISTING'
						? { kind: 'EXISTING', itemId: input.itemId }
						: {
								kind: 'NEW',
								item: prepareCreateItemInput(
									{ playbooks: ports.playbooks },
									{
										title: input.newItemTitle,
										playbookId: input.destination === 'PLAYBOOK' ? input.playbookId : null
									}
								)
							},
				attachment: {
					id: attachmentId,
					filename: sanitizeFilename(pending.filename),
					displayName: null,
					storageKey: attachmentStorageKey,
					mimeType: pending.mimeType,
					byteSize: bytes.byteLength,
					sha256: ports.attachmentStorage.sha256(bytes),
					uploadedAt: ports.clock.nowIso()
				}
			});
		} catch (cause) {
			ports.attachmentStorage.remove(attachmentStorageKey);
			throw cause;
		}
		if (!completed) {
			ports.attachmentStorage.remove(attachmentStorageKey);
			throw new InboxDocumentNotAvailableError();
		}
		// The normal attachment is durable and the pending row is gone. A
		// failed best-effort unlink must not turn that completed route into an
		// apparent failure and invite a duplicate confirmation.
		try {
			ports.storage.remove(pending.storageKey);
		} catch {
			// The isolated Inbox namespace leaves a recoverable orphan only.
		}
		return completed;
	} catch (cause) {
		ports.inbox.releaseRouting(pending.id, ports.clock.nowIso());
		throw cause;
	}
}

export function deleteInboxDocument(
	ports: Pick<InboxPorts, 'inbox' | 'storage'>,
	id: string
): void {
	const document = ports.inbox.deletePending(id);
	if (!document) return;
	try {
		ports.storage.remove(document.storageKey);
	} catch {
		// Metadata deletion is authoritative. Inbox cleanup is recoverable and
		// must not expose a filesystem path through the route error handler.
	}
}

export async function analyzeInboxDocument(
	ports: Pick<InboxPorts, 'inbox' | 'storage' | 'clock'> & {
		playbooks: PlaybookCatalogPort;
		items: ItemRepositoryPort;
		provider: DocumentRoutingProviderPort;
		settings: AppSettingsPort;
		runs: InboxAiRunRepositoryPort;
		ids: IdGeneratorPort;
	},
	input: {
		documentId: string;
		timeoutMs: number;
		maxOutputTokens: number;
		maxDocumentBytes: number;
		dailyLimit: number;
	}
): Promise<void> {
	if (!getAiSettings({ settings: ports.settings }).enabled)
		throw new InboxDocumentRejectedError('AI_DISABLED');
	const document = ports.inbox.getById(input.documentId);
	if (!document || document.status !== 'PENDING') throw new InboxDocumentNotAvailableError();
	if (document.byteSize > input.maxDocumentBytes) throw new InboxDocumentRejectedError('TOO_LARGE');
	const now = ports.clock.nowIso();
	const runId = ports.ids.newId();
	try {
		ports.runs.claimRun({
			id: runId,
			documentId: document.id,
			providerId: ports.provider.providerId,
			modelId: ports.provider.modelId,
			createdAt: now,
			windowStartIso: new Date(new Date(now).getTime() - 24 * 60 * 60 * 1000).toISOString(),
			dailyLimit: input.dailyLimit
		});
	} catch (cause) {
		if (cause instanceof DailyInboxAiLimitReachedError)
			throw new InboxDocumentRejectedError('DAILY_LIMIT');
		throw cause;
	}
	try {
		const bytes = readVerifiedPendingDocument(ports.storage, document, input.maxDocumentBytes);
		const playbooks = ports.playbooks.list();
		const result = await ports.provider.route({
			document: { mimeType: document.mimeType, bytes },
			timeoutMs: input.timeoutMs,
			maxOutputTokens: input.maxOutputTokens
		});
		const suggestion = normalizeRoutingSuggestion(
			result,
			playbooks,
			ports.items.listItems().map((item) => ({ id: item.id, title: item.title }))
		);
		if (!ports.inbox.updateSuggestion(document.id, suggestion, ports.clock.nowIso()))
			throw new InboxDocumentNotAvailableError();
		ports.runs.markSucceeded(runId);
	} catch (cause) {
		ports.runs.markFailed(runId);
		if (
			cause instanceof InboxDocumentRejectedError ||
			cause instanceof InboxDocumentNotAvailableError
		)
			throw cause;
		throw new InboxDocumentRejectedError('ANALYSIS_FAILED');
	}
}
