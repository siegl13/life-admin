/**
 * Repository/infrastructure ports the application layer depends on.
 * Concrete implementations live under $lib/server (wired together in
 * $lib/server/appPorts.ts) and are handed to use cases as plain
 * arguments — no DI container, no class hierarchy, just function
 * parameters. This keeps application/ importable and testable without
 * ever touching SQLite, matching the enforced ESLint boundary
 * (application/ must not import $lib/server/*).
 */
import type { Action, ActionDependency, ActionState } from '../domain/action/action';
import type { Cycle } from '../domain/cycle/cycle';
import type { IsoDate } from '../domain/date/isoDate';
import type { Event } from '../domain/event/event';
import type { Field, FieldType } from '../domain/field/field';
import type { Item } from '../domain/item/item';
import type { MaterializationPlan } from '../domain/playbook/materialize';
import type { NextCycleFieldSeed } from '../domain/cycle/rollover';
import type { EventPlan, ActionPlan } from '../domain/playbook/materialize';
import type { NormalizedPlaybook } from '../domain/playbook/normalize';
import type { WhatsNextItemInput } from '../domain/whatsnext/whatsNext';
import type { Attachment } from '../domain/attachment/attachment';
import type { InboxDocument, DocumentRouteSuggestion } from '../domain/inbox/document';
import type { ItemRelation } from '../domain/item/relation';
import type { ItemHistoryEvent } from '../domain/history/historyEvent';
export type { ItemHistoryEvent } from '../domain/history/historyEvent';
export type { PlaybookInstallPort } from './playbooks/installPlaybook';

export interface CreateItemPlaybookMeta {
	id: string;
	version: string;
	name: string;
	snapshot: NormalizedPlaybook;
}

export interface CreateItemInput {
	title: string;
	note?: string | null;
	playbook: CreateItemPlaybookMeta | null;
	materialization: MaterializationPlan;
}

export interface ItemRepositoryPort {
	createItem(input: CreateItemInput): Item;
	getItemById(id: string): Item | null;
	listItems(status?: import('../domain/item/item').ItemStatus): Item[];
	setItemStatus(itemId: string, status: import('../domain/item/item').ItemStatus): Item;
}

export interface RelatedItem {
	id: string;
	title: string;
	playbookName: string | null;
	status: import('../domain/item/item').ItemStatus;
}

export interface RelationCandidate extends RelatedItem {
	updatedAt: string;
	alreadyLinked: boolean;
}

export type LinkItemsResult = 'LINKED' | 'MISSING_ITEM' | 'ARCHIVED_ITEM' | 'DUPLICATE';
export type UnlinkItemsResult = 'UNLINKED' | 'MISSING_ITEM' | 'ARCHIVED_ITEM' | 'NOT_LINKED';

export interface ItemRelationRepositoryPort {
	link(itemAId: string, itemBId: string, createdAt: string): LinkItemsResult;
	unlink(itemAId: string, itemBId: string): UnlinkItemsResult;
	listRelated(itemId: string): RelatedItem[];
	listCandidates(itemId: string, query: string, limit: number): RelationCandidate[];
	countRelated(itemId: string): number;
	/** Explicit relation cleanup for a future item-deletion transaction. */
	deleteForItem(itemId: string): number;
	get(itemAId: string, itemBId: string): ItemRelation | null;
}

export interface CycleRepositoryPort {
	getActiveCycle(itemId: string): Cycle | null;
	/** Every cycle of an item, newest sequence first. */
	listCycles(itemId: string): Cycle[];
	/** Completes the given ACTIVE cycle and creates the next one in ONE
	 *  transaction. See docs/adr/000B (cycles and rollover). */
	startNextCycle(input: StartNextCycleInput): Cycle;
}
export interface StartNextCycleInput {
	itemId: string;
	completingCycleId: string;
	playbookVersion: string | null;
	fields: NextCycleFieldSeed[];
	events: EventPlan[];
	actions: ActionPlan[];
}

export interface FieldRepositoryPort {
	listFields(cycleId: string): Field[];
	addCustomField(cycleId: string, input: { label: string; type: FieldType }): Field;
	removeCustomField(cycleId: string, fieldKey: string): void;
}

export interface ScheduleRepositoryPort {
	applyFieldUpdatesAndRecalculate(
		cycleId: string,
		updates: readonly { fieldKey: string; value: string | null }[]
	): void;
}

export interface EventRepositoryPort {
	listEvents(cycleId: string): Event[];
}

export interface ActionRepositoryPort {
	listActions(cycleId: string): Action[];
	listDependencies(cycleId: string): ActionDependency[];
	/** Guarded: only succeeds if `actionId` belongs to `itemId`'s current
	 *  ACTIVE cycle, that item is ACTIVE, and the transition is legal —
	 *  see actionRepository.setActionState and the Slice 8 review,
	 *  finding 1. */
	setActionState(itemId: string, actionId: string, newState: ActionState): Action;
	addManualAction(cycleId: string, input: { label: string; dueDate: IsoDate | null }): Action;
	/** Guarded exactly like `setActionState`: only succeeds for a DERIVED
	 *  action belonging to `itemId`'s current ACTIVE cycle in an ACTIVE
	 *  item. `overrideDate: null` clears the override. */
	setActionDueOverride(itemId: string, actionId: string, overrideDate: IsoDate | null): Action;
}

export interface PlaybookCatalogPort {
	findById(id: string): NormalizedPlaybook | null;
	list(): NormalizedPlaybook[];
}

export interface WhatsNextRepositoryPort {
	loadItems(): WhatsNextItemInput[];
}

export interface SearchSourceRow {
	itemId: string;
	title: string;
	playbookName: string | null;
	playbookSnapshot: string | null;
	sourceKind: 'TITLE' | 'TYPE' | 'FIELD' | 'ACTION';
	fieldLabel: string | null;
	fieldType: FieldType | null;
	value: string | null;
	actionId: string | null;
	actionLabel: string | null;
	sourceOrder: number;
	moreMatches: number;
	total: number;
}

export interface SearchRepositoryPort {
	listActiveSources(query: string, limit: number): SearchSourceRow[];
}

export interface ItemHistoryRepositoryPort {
	insert(event: Omit<ItemHistoryEvent, 'id'> & { id: string }): void;
	listByItem(itemId: string, limit: number, offset: number): ItemHistoryEvent[];
	countByItem(itemId: string): number;
	deleteForItem(itemId: string): number;
}

export interface Clock {
	todayIso(): IsoDate;
	nowIso(): string;
	localHour(): number;
}

export interface AttachmentRepositoryPort {
	listByItem(itemId: string): Attachment[];
	listByCycle(cycleId: string): Attachment[];
	getById(id: string): Attachment | null;
	countByItem(itemId: string): number;
	insert(row: Attachment): Attachment;
	rename(itemId: string, id: string, displayName: string | null): Attachment | null;
	deleteById(id: string): Attachment | null;
	listStorageKeysForItem(itemId: string): string[];
}
export interface AttachmentStoragePort {
	store(id: string, bytes: Uint8Array): string;
	readBytes(key: string): Uint8Array;
	openReadStream(key: string): ReadableStream<Uint8Array>;
	/** Best effort: never throws. Once the caller's own row deletion has
	 *  succeeded, a filesystem failure here is logged server-side and
	 *  swallowed rather than surfaced as a failed deletion. */
	remove(key: string): void;
	sha256(bytes: Uint8Array): string;
}
export interface InboxRepositoryPort {
	listPending(): InboxDocument[];
	getById(id: string): InboxDocument | null;
	insert(document: InboxDocument): InboxDocument;
	updateSuggestion(id: string, suggestion: DocumentRouteSuggestion, now: string): boolean;
	claimForRouting(id: string, now: string): InboxDocument | null;
	releaseRouting(id: string, now: string): void;
	recoverInterruptedRouting(now: string): void;
	completeRouting(input: {
		documentId: string;
		destination: { kind: 'EXISTING'; itemId: string } | { kind: 'NEW'; item: CreateItemInput };
		attachment: Omit<Attachment, 'itemId' | 'cycleId'>;
	}): { itemId: string; attachmentId: string } | null;
	deleteClaimed(id: string): boolean;
	deletePending(id: string): InboxDocument | null;
}
export class DailyInboxAiLimitReachedError extends Error {}
export interface InboxAiRunRepositoryPort {
	/** Claims a counted outbound routing attempt before provider access. The
	 * implementation counts every AI attempt in the rolling window atomically. */
	claimRun(input: {
		id: string;
		documentId: string;
		providerId: string;
		modelId: string;
		createdAt: string;
		windowStartIso: string;
		dailyLimit: number;
	}): void;
	markSucceeded(id: string): void;
	markFailed(id: string): void;
}
export interface InboxStoragePort {
	store(id: string, bytes: Uint8Array): string;
	readBytes(key: string, maxBytes?: number): Uint8Array;
	remove(key: string): void;
	sha256(bytes: Uint8Array): string;
}
export interface IdGeneratorPort {
	newId(): string;
}

export interface AccountUser {
	id: string;
	username: string;
	passwordHash: string;
	role: string;
	failedLoginCount: number;
	lockedUntil: string | null;
}

export interface OwnerAccountPort {
	ownerExists(): boolean;
	findByUsername(username: string): AccountUser | null;
	findById(id: string): AccountUser | null;
	createOwner(input: {
		id: string;
		username: string;
		passwordHash: string;
		nowIso: string;
	}): AccountUser;
	updatePasswordHash(userId: string, passwordHash: string, nowIso: string): void;
	/** Atomically increments the failure count and derives the lockout state
	 *  from the result, in one repository-level transaction (never a
	 *  read-in-the-application-then-write pattern), so concurrent callers
	 *  can never lose an increment. */
	recordFailedLogin(userId: string, nowIso: string): void;
	clearFailedLogins(userId: string, nowIso: string): void;
}

export interface SessionRecord {
	tokenHash: string;
	userId: string;
	createdAt: string;
	lastSeenAt: string;
	expiresAt: string;
}

export interface SessionPort {
	create(session: SessionRecord): void;
	find(tokenHash: string): SessionRecord | null;
	touch(tokenHash: string, nowIso: string): void;
	remove(tokenHash: string): void;
	removeAllForUser(userId: string): void;
	removeExpired(nowIso: string): number;
}

export interface TokenGeneratorPort {
	newSessionToken(): { token: string; tokenHash: string };
}

/** Async so scrypt never blocks the server event loop. */
export interface PasswordHasherPort {
	hash(plain: string): Promise<string>;
	verify(plain: string, stored: string): Promise<boolean>;
	needsRehash(stored: string): boolean;
}
