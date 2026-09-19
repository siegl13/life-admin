import { today } from '$lib/domain/date/isoDate';
import type {
	ActionRepositoryPort,
	Clock,
	CycleRepositoryPort,
	EventRepositoryPort,
	FieldRepositoryPort,
	ItemRepositoryPort,
	PlaybookCatalogPort,
	ScheduleRepositoryPort,
	WhatsNextRepositoryPort,
	OwnerAccountPort,
	SessionPort,
	TokenGeneratorPort,
	PasswordHasherPort,
	AttachmentRepositoryPort,
	AttachmentStoragePort,
	InboxRepositoryPort,
	InboxStoragePort,
	InboxAiRunRepositoryPort,
	PlaybookInstallPort,
	SearchRepositoryPort,
	ItemRelationRepositoryPort
} from '$lib/application/ports';
import type {
	AppSettingsPort,
	AttachmentReadPort,
	ExtractionRunRepositoryPort
} from '$lib/application/ai/ports';
import type { ItemHistoryRepositoryPort } from '$lib/application/ports';
import { config } from './config';
import { getDb } from './db/database';
import * as actionRepo from './db/repositories/actionRepository';
import * as cycleRepo from './db/repositories/cycleRepository';
import * as eventRepo from './db/repositories/eventRepository';
import * as fieldRepo from './db/repositories/fieldRepository';
import * as itemRepo from './db/repositories/itemRepository';
import * as scheduleRepo from './db/repositories/scheduleRepository';
import { loadWhatsNextItems } from './db/repositories/whatsNextRepository';
import { loadPlaybookCatalog } from './playbooks/catalog';
import {
	countCustomPlaybookCandidates,
	installCustomPlaybook,
	uninstallCustomPlaybook
} from './playbooks/install';
import { parsePlaybookText } from './playbooks/loader';
import * as authRepo from './db/repositories/authRepository';
import { passwordHasher } from './auth/passwordHasher';
import { withHashGuard } from './auth/hashGuard';
import { newSessionToken } from './auth/sessionToken';
import { randomUUID } from 'node:crypto';
import * as attachmentRepo from './db/repositories/attachmentRepository';
import * as attachmentStorage from './files/attachmentStorage';
import * as inboxRepo from './db/repositories/inboxRepository';
import * as inboxStorage from './files/inboxStorage';
import * as appSettingsRepo from './db/repositories/appSettingsRepository';
import * as extractionRepo from './db/repositories/extractionRepository';
import { selectProvider } from './ai/selectProvider';
import type {
	NotificationChannelsPort,
	NotificationDeliveryRepositoryPort,
	NotificationSettingsPort
} from '$lib/application/notify/ports';
import * as notificationRepo from './db/repositories/notificationRepository';
import * as searchRepo from './db/repositories/searchRepository';
import * as relationRepo from './db/repositories/itemRelationRepository';
import * as historyRepo from './db/repositories/itemHistoryRepository';
import {
	getDispatchNotificationSettings,
	getNotificationSettings,
	getSecret
} from './notify/notificationSettingsRepository';
import { selectChannel } from './notify/selectChannel';

/**
 * Wires the concrete SQLite/filesystem adapters to the application
 * layer's ports. This is the only place in the codebase allowed to know
 * both "what an application use case needs" and "how that's actually
 * stored" — every route (`+page.server.ts`) imports from here rather
 * than reaching into `server/db` or `server/playbooks` directly.
 *
 * The playbook catalog is intentionally re-scanned on every call rather
 * than cached: custom playbooks can be added to /data/playbooks while
 * the app is running, and a stale in-memory cache would be a worse
 * failure mode than the cost of re-parsing a handful of small YAML
 * files per request.
 */

export const itemsPort: ItemRepositoryPort = {
	createItem: (input) => itemRepo.createItem(getDb(), input),
	getItemById: (id) => itemRepo.getItemById(getDb(), id),
	listItems: (status) => itemRepo.listItems(getDb(), status),
	setItemStatus: (id, status) => itemRepo.setItemStatus(getDb(), id, status)
};

export const cyclesPort: CycleRepositoryPort = {
	getActiveCycle: (itemId) => cycleRepo.getActiveCycle(getDb(), itemId),
	listCycles: (itemId) => cycleRepo.listCycles(getDb(), itemId),
	startNextCycle: (input) => cycleRepo.startNextCycle(getDb(), input)
};

export const fieldsPort: FieldRepositoryPort = {
	listFields: (cycleId) => fieldRepo.listFields(getDb(), cycleId),
	addCustomField: (cycleId, input) => fieldRepo.addCustomField(getDb(), cycleId, input),
	removeCustomField: (cycleId, fieldKey) => fieldRepo.removeCustomField(getDb(), cycleId, fieldKey)
};

export const eventsPort: EventRepositoryPort = {
	listEvents: (cycleId) => eventRepo.listEvents(getDb(), cycleId)
};

export const scheduleRepositoryPort: ScheduleRepositoryPort = {
	applyFieldUpdatesAndRecalculate: (cycleId, updates) =>
		scheduleRepo.applyFieldUpdatesAndRecalculate(getDb(), cycleId, updates)
};

export const actionsPort: ActionRepositoryPort = {
	listActions: (cycleId) => actionRepo.listActions(getDb(), cycleId),
	listDependencies: (cycleId) => actionRepo.listDependencies(getDb(), cycleId),
	setActionState: (itemId, actionId, newState) =>
		actionRepo.setActionState(getDb(), itemId, actionId, newState),
	addManualAction: (cycleId, input) => actionRepo.addManualAction(getDb(), cycleId, input),
	setActionDueOverride: (itemId, actionId, overrideDate) =>
		actionRepo.setActionDueOverride(getDb(), itemId, actionId, overrideDate)
};

function catalog() {
	return loadPlaybookCatalog(config.bundledPlaybooksDir, config.customPlaybooksDir);
}

export const playbooksPort: PlaybookCatalogPort = {
	findById: (id) => catalog().entries.find((e) => e.playbook.id === id)?.playbook ?? null,
	list: () => catalog().entries.map((e) => e.playbook)
};

export const playbookInstallPort: PlaybookInstallPort & {
	uninstall(playbookId: string, provenCustomPath: string | null): void;
} = {
	parse: parsePlaybookText,
	install: (input) =>
		installCustomPlaybook({
			rootDir: config.customPlaybooksDir,
			...input
		}),
	uninstall: (playbookId, provenCustomPath) =>
		uninstallCustomPlaybook({
			rootDir: config.customPlaybooksDir,
			playbookId,
			provenCustomPath
		}),
	countCustom: () => countCustomPlaybookCandidates(config.customPlaybooksDir)
};

export const whatsNextPort: WhatsNextRepositoryPort = {
	loadItems: () => loadWhatsNextItems(getDb())
};

export const searchPort: SearchRepositoryPort = {
	listActiveSources: (query, limit) => searchRepo.listActiveSources(getDb(), query, limit)
};

export const itemRelationsPort: ItemRelationRepositoryPort = {
	link: (itemAId, itemBId, createdAt) => relationRepo.link(getDb(), itemAId, itemBId, createdAt),
	unlink: (itemAId, itemBId) => relationRepo.unlink(getDb(), itemAId, itemBId),
	listRelated: (itemId) => relationRepo.listRelated(getDb(), itemId),
	listCandidates: (itemId, query, limit) =>
		relationRepo.listCandidates(getDb(), itemId, query, limit),
	countRelated: (itemId) => relationRepo.countRelated(getDb(), itemId),
	deleteForItem: (itemId) => relationRepo.deleteForItem(getDb(), itemId),
	get: (itemAId, itemBId) => relationRepo.get(getDb(), itemAId, itemBId)
};

export const itemHistoryPort: ItemHistoryRepositoryPort = {
	insert: (event) => historyRepo.insert(getDb(), event),
	listByItem: (itemId, limit, offset) => historyRepo.listByItem(getDb(), itemId, limit, offset),
	countByItem: (itemId) => historyRepo.countByItem(getDb(), itemId),
	deleteForItem: (itemId) => historyRepo.deleteForItem(getDb(), itemId)
};

export const clock: Clock = {
	todayIso: () => today(),
	nowIso: () => new Date().toISOString(),
	localHour: () => new Date().getHours()
};

export const accountsPort: OwnerAccountPort = {
	ownerExists: () => authRepo.ownerExists(getDb()),
	findByUsername: (username) => authRepo.findByUsername(getDb(), username),
	findById: (id) => authRepo.findById(getDb(), id),
	createOwner: (input) => authRepo.createOwner(getDb(), input),
	updatePasswordHash: (userId, hash, now) =>
		authRepo.updatePasswordHash(getDb(), userId, hash, now),
	recordFailedLogin: (userId, now) => authRepo.recordFailedLogin(getDb(), userId, now),
	clearFailedLogins: (userId, now) => authRepo.clearFailedLogins(getDb(), userId, now)
};

export const sessionsPort: SessionPort = {
	create: (session) => authRepo.createSession(getDb(), session),
	find: (hash) => authRepo.findSession(getDb(), hash),
	touch: (hash, now) => authRepo.touchSession(getDb(), hash, now),
	remove: (hash) => authRepo.removeSession(getDb(), hash),
	removeAllForUser: (userId) => authRepo.removeAllForUser(getDb(), userId),
	removeExpired: (now) => authRepo.removeExpired(getDb(), now)
};

export const tokensPort: TokenGeneratorPort = { newSessionToken };
export const passwordHasherPort: PasswordHasherPort = {
	...passwordHasher,
	// Guarded, not the plain hasher: a flood of unknown-username login
	// attempts still needs a dummy-hash verify each (see login.ts), so this
	// is the process-wide resource guard's one and only enforcement point.
	// A guard-exhausted attempt is treated exactly like a wrong password
	// (returns false), never a distinguishable error, so it reveals nothing
	// about whether the attempted username exists.
	async verify(plain, stored) {
		try {
			return await withHashGuard(() => passwordHasher.verify(plain, stored));
		} catch {
			return false;
		}
	}
};
export const idsPort = { newId: () => randomUUID() };
export const attachmentsPort: AttachmentRepositoryPort = {
	listByItem: (id) => attachmentRepo.listByItem(getDb(), id),
	listByCycle: (id) => attachmentRepo.listByCycle(getDb(), id),
	getById: (id) => attachmentRepo.getById(getDb(), id),
	countByItem: (id) => attachmentRepo.countByItem(getDb(), id),
	insert: (row) => attachmentRepo.insert(getDb(), row),
	rename: (itemId, id, displayName) => attachmentRepo.rename(getDb(), itemId, id, displayName),
	deleteById: (id) => attachmentRepo.deleteById(getDb(), id),
	listStorageKeysForItem: (id) => attachmentRepo.listStorageKeysForItem(getDb(), id)
};
export const attachmentStoragePort: AttachmentStoragePort = attachmentStorage;
export const inboxPort: InboxRepositoryPort = {
	listPending: () => inboxRepo.listPending(getDb()),
	getById: (id) => inboxRepo.getById(getDb(), id),
	insert: (document) => inboxRepo.insert(getDb(), document),
	updateSuggestion: (id, suggestion, now) =>
		inboxRepo.updateSuggestion(getDb(), id, suggestion, now),
	claimForRouting: (id, now) => inboxRepo.claimForRouting(getDb(), id, now),
	releaseRouting: (id, now) => inboxRepo.releaseRouting(getDb(), id, now),
	recoverInterruptedRouting: (now) => inboxRepo.recoverInterruptedRouting(getDb(), now),
	completeRouting: (input) => inboxRepo.completeRouting(getDb(), input),
	deleteClaimed: (id) => inboxRepo.deleteClaimed(getDb(), id),
	deletePending: (id) => inboxRepo.deletePending(getDb(), id)
};
export const inboxStoragePort: InboxStoragePort = {
	store: inboxStorage.storeInbox,
	readBytes: inboxStorage.readInboxBytes,
	remove: inboxStorage.removeInbox,
	sha256: inboxStorage.inboxSha256
};
export const inboxAiRunsPort: InboxAiRunRepositoryPort = {
	claimRun: (input) => inboxRepo.claimAiRun(getDb(), input),
	markSucceeded: (id) => inboxRepo.markAiRunSucceeded(getDb(), id),
	markFailed: (id) => inboxRepo.markAiRunFailed(getDb(), id)
};

export const appSettingsPort: AppSettingsPort = {
	get: (key) => appSettingsRepo.get(getDb(), key),
	set: (key, value) => appSettingsRepo.set(getDb(), key, value)
};

export const attachmentReadPort: AttachmentReadPort = {
	readBytes: (key, maxBytes) => attachmentStorage.readBytes(key, maxBytes)
};

export const extractionRunsPort: ExtractionRunRepositoryPort = {
	claimRun: (input) => extractionRepo.claimRun(getDb(), input),
	markSucceeded: (runId, input) => extractionRepo.markSucceeded(getDb(), runId, input),
	markFailed: (runId) => extractionRepo.markFailed(getDb(), runId),
	getById: (runId) => extractionRepo.getById(getDb(), runId),
	findNewestPendingRun: (cycleId) => extractionRepo.findNewestPendingRun(getDb(), cycleId),
	listSuggestions: (runId) => extractionRepo.listSuggestions(getDb(), runId),
	listAdditionalSuggestions: (runId) => extractionRepo.listAdditionalSuggestions(getDb(), runId),
	applyRun: (input) => extractionRepo.applyRun(getDb(), input),
	dismissRun: (input) => extractionRepo.dismissRun(getDb(), input),
	addAdditionalFields: (input) => extractionRepo.addAdditionalFields(getDb(), input)
};

/** Selected once at module load, same as every other port here — pure
 *  over `process.env` (see selectProvider.ts), so this stays a plain
 *  module-level const, not a factory. */
export const extractionProvider = selectProvider(process.env);

export const notificationSettingsPort: NotificationSettingsPort = {
	getSettings: () => getDispatchNotificationSettings(getDb())
};

export const notificationDeliveriesPort: NotificationDeliveryRepositoryPort = {
	claim: (input) => notificationRepo.claim(getDb(), input),
	markSent: (actionId, kind, targetDate, channel, nowIso) =>
		notificationRepo.markSent(getDb(), actionId, kind, targetDate, channel, nowIso),
	markAttemptFailed: (actionId, kind, targetDate, channel, reason, maxAttempts, nowIso) =>
		notificationRepo.markAttemptFailed(
			getDb(),
			actionId,
			kind,
			targetDate,
			channel,
			reason,
			maxAttempts,
			nowIso
		),
	listRetryable: (maxAttempts, limit, eligible) =>
		notificationRepo.listRetryable(getDb(), maxAttempts, limit, eligible),
	getLastFailure: () => notificationRepo.getLastFailure(getDb())
};

export const notificationChannelsPort: NotificationChannelsPort = {
	get: (channel) => {
		const settings = getNotificationSettings(getDb());
		return selectChannel(process.env, {
			channel,
			baseUrl: settings.baseUrl,
			topic: settings.topic,
			token: getSecret(getDb(), 'secret.notify.ntfy.token'),
			webhookUrl: getSecret(getDb(), 'secret.notify.slack.webhookUrl')
		});
	}
};
