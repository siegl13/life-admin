import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database';
import * as appSettingsRepo from '../db/repositories/appSettingsRepository';
import * as extractionRepo from '../db/repositories/extractionRepository';
import * as itemRepo from '../db/repositories/itemRepository';
import * as cycleRepo from '../db/repositories/cycleRepository';
import * as fieldRepo from '../db/repositories/fieldRepository';
import * as actionRepo from '../db/repositories/actionRepository';
import * as attachmentRepo from '../db/repositories/attachmentRepository';
import {
	extractFromDocument,
	ExtractionNotAllowedError
} from '$lib/application/ai/extractFromDocument';
import {
	ExtractionFailedError,
	type DocumentExtractionProviderPort
} from '$lib/application/ai/extraction';

/**
 * Lives under `src/lib/server/`, not `src/lib/application/ai/`, precisely
 * because it wires the real repositories directly (the ESLint
 * `application/`-boundary rule forbids `application/**` from importing
 * `$lib/server/*` — ports.ts is the only allowed seam there). Wired
 * against a real (temp-file) SQLite database and the real repositories —
 * not `vi.fn()` ports — so this proves the no-key path stops before the
 * provider boundary through the *actual* production wiring, not only
 * through a hand-rolled mock. See the Slice 9 brief's Required Automated
 * Coverage: "A deterministic integration test injects a spy provider into
 * the no-key path and asserts exactly zero provider invocations."
 */

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-ai-no-key-'));
	db = openDatabase(path.join(tmpDir, 'test.sqlite'));
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seedActiveItemWithAttachment() {
	const itemId = `item-${crypto.randomUUID()}`;
	const cycleId = `cycle-${crypto.randomUUID()}`;
	const attachmentId = `att-${crypto.randomUUID()}`;
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO items (id, title, status, created_at, updated_at) VALUES (?, 'Test item', 'ACTIVE', ?, ?)`
	).run(itemId, now, now);
	db.prepare(
		`INSERT INTO cycles (id, item_id, sequence, status, created_at) VALUES (?, ?, 1, 'ACTIVE', ?)`
	).run(cycleId, itemId, now);
	db.prepare(
		`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, position, value)
		 VALUES (?, ?, 'contract_end', 'Contract end', 'date', 'PLAYBOOK', 0, NULL)`
	).run(crypto.randomUUID(), cycleId);
	db.prepare(
		`INSERT INTO attachments (id, item_id, filename, storage_key, mime_type, byte_size, sha256, uploaded_at)
		 VALUES (?, ?, 'a.pdf', ?, 'application/pdf', 10, ?, ?)`
	).run(attachmentId, itemId, `ab/${crypto.randomUUID()}`, 'a'.repeat(64), now);
	return { itemId, attachmentId };
}

/** The real repository wiring, parameterized only by the two things each
 *  test below varies (the provider and the attachment-bytes reader), so
 *  both tests exercise the actual production port shapes rather than a
 *  hand-rolled mock. */
function realPorts(
	provider: DocumentExtractionProviderPort,
	attachmentBytes: { readBytes: (key: string, maxBytes: number) => Uint8Array }
): Parameters<typeof extractFromDocument>[0] {
	return {
		actions: {
			listActions: (cycleId: string) => actionRepo.listActions(db, cycleId),
			listDependencies: (cycleId: string) => actionRepo.listDependencies(db, cycleId),
			setActionState: (itemId: string, actionId: string, state: never) =>
				actionRepo.setActionState(db, itemId, actionId, state),
			addManualAction: (cycleId: string, input: Parameters<typeof actionRepo.addManualAction>[2]) =>
				actionRepo.addManualAction(db, cycleId, input),
			setActionDueOverride: (itemId: string, actionId: string, date: string | null) =>
				actionRepo.setActionDueOverride(db, itemId, actionId, date)
		},
		items: {
			getItemById: (id: string) => itemRepo.getItemById(db, id),
			createItem: (input: Parameters<typeof itemRepo.createItem>[1]) =>
				itemRepo.createItem(db, input),
			listItems: (status: Parameters<typeof itemRepo.listItems>[1]) =>
				itemRepo.listItems(db, status),
			setItemStatus: (id: string, status: Parameters<typeof itemRepo.setItemStatus>[2]) =>
				itemRepo.setItemStatus(db, id, status)
		},
		cycles: {
			getActiveCycle: (id: string) => cycleRepo.getActiveCycle(db, id),
			listCycles: (id: string) => cycleRepo.listCycles(db, id),
			startNextCycle: (input: Parameters<typeof cycleRepo.startNextCycle>[1]) =>
				cycleRepo.startNextCycle(db, input)
		},
		fields: {
			listFields: (cycleId: string) => fieldRepo.listFields(db, cycleId),
			addCustomField: (cycleId: string, input: Parameters<typeof fieldRepo.addCustomField>[2]) =>
				fieldRepo.addCustomField(db, cycleId, input),
			removeCustomField: (cycleId: string, key: string) =>
				fieldRepo.removeCustomField(db, cycleId, key),
			setFieldConfirmed: (cycleId: string, key: string, confirmed: boolean) =>
				fieldRepo.setFieldConfirmed(db, cycleId, key, confirmed)
		},
		attachments: {
			getById: (id: string) => attachmentRepo.getById(db, id),
			listByItem: (id: string) => attachmentRepo.listByItem(db, id),
			listByCycle: (id: string) => attachmentRepo.listByCycle(db, id),
			countByItem: (id: string) => attachmentRepo.countByItem(db, id),
			rename: (itemId: string, id: string, filename: string) =>
				attachmentRepo.rename(db, itemId, id, filename),
			insert: (row: Parameters<typeof attachmentRepo.insert>[1]) => attachmentRepo.insert(db, row),
			deleteById: (id: string) => attachmentRepo.deleteById(db, id),
			listStorageKeysForItem: (id: string) => attachmentRepo.listStorageKeysForItem(db, id)
		},
		attachmentBytes,
		settings: {
			get: (key: string) => appSettingsRepo.get(db, key),
			set: (key: string, v: string) => appSettingsRepo.set(db, key, v)
		},
		runs: {
			claimRun: (input: Parameters<typeof extractionRepo.claimRun>[1]) =>
				extractionRepo.claimRun(db, input),
			markSucceeded: (runId: string, input: Parameters<typeof extractionRepo.markSucceeded>[2]) =>
				extractionRepo.markSucceeded(db, runId, input),
			markFailed: (runId: string) => extractionRepo.markFailed(db, runId),
			getById: (runId: string) => extractionRepo.getById(db, runId),
			findNewestPendingRun: (cycleId: string) => extractionRepo.findNewestPendingRun(db, cycleId),
			listSuggestions: (runId: string) => extractionRepo.listSuggestions(db, runId),
			listAdditionalSuggestions: (runId: string) =>
				extractionRepo.listAdditionalSuggestions(db, runId),
			listActionSuggestions: (runId: string) => extractionRepo.listActionSuggestions(db, runId),
			addActions: (input: Parameters<typeof extractionRepo.addActions>[1]) =>
				extractionRepo.addActions(db, input),
			addAdditionalFields: (input: Parameters<typeof extractionRepo.addAdditionalFields>[1]) =>
				extractionRepo.addAdditionalFields(db, input),
			applyRun: (input: Parameters<typeof extractionRepo.applyRun>[1]) =>
				extractionRepo.applyRun(db, input),
			dismissRun: (input: Parameters<typeof extractionRepo.dismissRun>[1]) =>
				extractionRepo.dismissRun(db, input)
		},
		provider,
		ids: { newId: () => crypto.randomUUID() },
		clock: {
			nowIso: () => new Date().toISOString(),
			todayIso: () => new Date().toISOString().slice(0, 10),
			localHour: () => new Date().getHours()
		}
	};
}

const BOUNDS = {
	hasApiKey: false,
	maxDocumentBytes: 8 * 1024 * 1024,
	timeoutMs: 60_000,
	maxOutputTokens: 2000,
	dailyLimit: 20
};

describe('extractFromDocument (no-key path, real repositories)', () => {
	it('rejects before any provider invocation when AI is enabled but no API key is configured', async () => {
		const { itemId, attachmentId } = seedActiveItemWithAttachment();
		appSettingsRepo.set(db, 'ai.enabled', '1');

		const spyProvider: DocumentExtractionProviderPort = {
			providerId: 'spy',
			modelId: 'spy-v1',
			extract: vi.fn(async () => ({ providerId: 'spy', modelId: 'spy-v1', suggestions: [] }))
		};
		const throwingReadBytes = {
			readBytes: vi.fn((_key: string, _maxBytes: number): Uint8Array => {
				throw new Error('must never be called on the no-key path');
			})
		};

		await expect(
			extractFromDocument(
				realPorts(spyProvider, throwingReadBytes),
				{ itemId, attachmentId },
				BOUNDS
			)
		).rejects.toThrow(ExtractionNotAllowedError);

		expect(spyProvider.extract).not.toHaveBeenCalled();
		expect((db.prepare('SELECT COUNT(*) n FROM extraction_runs').get() as { n: number }).n).toBe(0);
	});
});

describe('extractFromDocument (post-claim failure, real repositories)', () => {
	it('records provider-incomplete failure once and persists no partial suggestions', async () => {
		const { itemId, attachmentId } = seedActiveItemWithAttachment();
		appSettingsRepo.set(db, 'ai.enabled', '1');
		const provider: DocumentExtractionProviderPort = {
			providerId: 'fake',
			modelId: 'fake-v1',
			extract: vi.fn(async () => {
				throw new ExtractionFailedError('incomplete response');
			})
		};
		const bytes = { readBytes: vi.fn(() => new Uint8Array([1, 2, 3])) };

		await expect(
			extractFromDocument(
				realPorts(provider, bytes),
				{ itemId, attachmentId },
				{ ...BOUNDS, hasApiKey: true, maxOutputTokens: 8000 }
			)
		).rejects.toThrow(ExtractionFailedError);

		expect(provider.extract).toHaveBeenCalledTimes(1);
		expect(provider.extract).toHaveBeenCalledWith(
			expect.objectContaining({ maxOutputTokens: 8000 })
		);
		expect(
			db.prepare('SELECT status FROM extraction_runs WHERE item_id = ?').get(itemId)
		).toMatchObject({ status: 'FAILED' });
		expect(
			(db.prepare('SELECT COUNT(*) n FROM extraction_suggestions').get() as { n: number }).n
		).toBe(0);
		expect(
			(
				db.prepare('SELECT COUNT(*) n FROM extraction_additional_suggestions').get() as {
					n: number;
				}
			).n
		).toBe(0);
		expect(
			(db.prepare('SELECT COUNT(*) n FROM extraction_action_suggestions').get() as { n: number }).n
		).toBe(0);
	});

	it('persists the claimed run as FAILED with zero suggestions when reading the attachment bytes throws', async () => {
		const { itemId, attachmentId } = seedActiveItemWithAttachment();
		appSettingsRepo.set(db, 'ai.enabled', '1');

		const provider: DocumentExtractionProviderPort = {
			providerId: 'fake',
			modelId: 'fake-v1',
			extract: vi.fn(async () => ({ providerId: 'fake', modelId: 'fake-v1', suggestions: [] }))
		};
		const throwingReadBytes = {
			readBytes: vi.fn((_key: string, _maxBytes: number): Uint8Array => {
				throw new Error('ENOENT: simulated real filesystem failure');
			})
		};

		await expect(
			extractFromDocument(
				realPorts(provider, throwingReadBytes),
				{ itemId, attachmentId },
				{ ...BOUNDS, hasApiKey: true }
			)
		).rejects.toThrow();

		expect(throwingReadBytes.readBytes).toHaveBeenCalledTimes(1);
		expect(provider.extract).not.toHaveBeenCalled();
		const row = db.prepare('SELECT status FROM extraction_runs WHERE item_id = ?').get(itemId) as
			{ status: string } | undefined;
		expect(row?.status).toBe('FAILED');
		expect(
			(db.prepare('SELECT COUNT(*) n FROM extraction_suggestions').get() as { n: number }).n
		).toBe(0);
	});
});
