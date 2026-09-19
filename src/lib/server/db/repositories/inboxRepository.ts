import type Database from 'better-sqlite3';
import {
	parseDocumentRouteSuggestion,
	type InboxDocument,
	type DocumentRouteSuggestion
} from '$lib/domain/inbox/document';
import type { AttachmentMimeType } from '$lib/domain/attachment/attachment';
import {
	DailyInboxAiLimitReachedError,
	type InboxAiRunRepositoryPort,
	type InboxRepositoryPort
} from '$lib/application/ports';
import { MAX_ATTACHMENTS_PER_ITEM } from '$lib/domain/attachment/attachment';
import { createItemInTransaction } from './itemRepository';
import { assertItemIsWritable } from './writeGuards';

type Row = {
	id: string;
	storage_key: string;
	filename: string;
	mime_type: string;
	byte_size: number;
	sha256: string;
	suggestion_json: string | null;
	status: 'PENDING' | 'ROUTING';
	created_at: string;
	updated_at: string;
};
function map(row: Row): InboxDocument {
	return {
		id: row.id,
		storageKey: row.storage_key,
		filename: row.filename,
		mimeType: row.mime_type as AttachmentMimeType,
		byteSize: row.byte_size,
		sha256: row.sha256,
		suggestion: parseSuggestion(row.suggestion_json),
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function parseSuggestion(raw: string | null): DocumentRouteSuggestion | null {
	if (!raw) return null;
	try {
		return parseDocumentRouteSuggestion(JSON.parse(raw));
	} catch {
		return null;
	}
}
export const listPending = (db: Database.Database): InboxDocument[] =>
	(
		db
			.prepare(
				"SELECT * FROM inbox_documents WHERE status = 'PENDING' ORDER BY created_at DESC, rowid DESC"
			)
			.all() as Row[]
	).map(map);
export const getById = (db: Database.Database, id: string): InboxDocument | null => {
	const row = db.prepare('SELECT * FROM inbox_documents WHERE id = ?').get(id) as Row | undefined;
	return row ? map(row) : null;
};
export const insert = (db: Database.Database, document: InboxDocument): InboxDocument => {
	db.prepare('INSERT INTO inbox_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
		document.id,
		document.storageKey,
		document.filename,
		document.mimeType,
		document.byteSize,
		document.sha256,
		document.suggestion ? JSON.stringify(document.suggestion) : null,
		document.status,
		document.createdAt,
		document.updatedAt
	);
	return document;
};
export const updateSuggestion = (
	db: Database.Database,
	id: string,
	suggestion: DocumentRouteSuggestion,
	now: string
): boolean =>
	db
		.prepare(
			"UPDATE inbox_documents SET suggestion_json = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'"
		)
		.run(JSON.stringify(suggestion), now, id).changes === 1;
export const claimForRouting = (
	db: Database.Database,
	id: string,
	now: string
): InboxDocument | null => {
	const result = db
		.prepare(
			"UPDATE inbox_documents SET status = 'ROUTING', updated_at = ? WHERE id = ? AND status = 'PENDING'"
		)
		.run(now, id);
	return result.changes === 1 ? getById(db, id) : null;
};
export const releaseRouting = (db: Database.Database, id: string, now: string): void => {
	db.prepare(
		"UPDATE inbox_documents SET status = 'PENDING', updated_at = ? WHERE id = ? AND status = 'ROUTING'"
	).run(now, id);
};
export const recoverInterruptedRouting = (db: Database.Database, now: string): void => {
	db.prepare(
		"UPDATE inbox_documents SET status = 'PENDING', updated_at = ? WHERE status = 'ROUTING'"
	).run(now);
};
export const completeRouting = (
	db: Database.Database,
	input: Parameters<InboxRepositoryPort['completeRouting']>[0]
): ReturnType<InboxRepositoryPort['completeRouting']> =>
	db.transaction(() => {
		const claimed = db
			.prepare("SELECT 1 FROM inbox_documents WHERE id = ? AND status = 'ROUTING'")
			.get(input.documentId);
		if (!claimed) return null;
		const itemId =
			input.destination.kind === 'NEW'
				? createItemInTransaction(db, input.destination.item).id
				: input.destination.itemId;
		assertItemIsWritable(db, itemId);
		if (countAttachmentsForItem(db, itemId) >= MAX_ATTACHMENTS_PER_ITEM)
			throw new Error('ATTACHMENT_LIMIT');
		const cycle = db
			.prepare("SELECT id FROM cycles WHERE item_id = ? AND status = 'ACTIVE'")
			.get(itemId) as { id: string } | undefined;
		db.prepare(
			'INSERT INTO attachments (id,item_id,cycle_id,filename,display_name,storage_key,mime_type,byte_size,sha256,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
		).run(
			input.attachment.id,
			itemId,
			cycle?.id ?? null,
			input.attachment.filename,
			input.attachment.displayName,
			input.attachment.storageKey,
			input.attachment.mimeType,
			input.attachment.byteSize,
			input.attachment.sha256,
			input.attachment.uploadedAt
		);
		db.prepare("DELETE FROM inbox_documents WHERE id = ? AND status = 'ROUTING'").run(
			input.documentId
		);
		return { itemId, attachmentId: input.attachment.id };
	})();

function countAttachmentsForItem(db: Database.Database, itemId: string): number {
	return (
		db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE item_id = ?').get(itemId) as {
			n: number;
		}
	).n;
}
export const deleteClaimed = (db: Database.Database, id: string): boolean =>
	db.prepare("DELETE FROM inbox_documents WHERE id = ? AND status = 'ROUTING'").run(id).changes ===
	1;
export const deletePending = (db: Database.Database, id: string): InboxDocument | null => {
	const row = db
		.prepare("DELETE FROM inbox_documents WHERE id = ? AND status = 'PENDING' RETURNING *")
		.get(id) as Row | undefined;
	return row ? map(row) : null;
};

export const claimAiRun = (
	db: Database.Database,
	input: Parameters<InboxAiRunRepositoryPort['claimRun']>[0]
): void => {
	const run = db.transaction(() => {
		const { n } = db
			.prepare(
				`SELECT COUNT(*) AS n FROM (
					SELECT created_at FROM extraction_runs WHERE created_at >= ?
					UNION ALL
					SELECT created_at FROM inbox_ai_runs WHERE created_at >= ?
				)`
			)
			.get(input.windowStartIso, input.windowStartIso) as { n: number };
		if (n >= input.dailyLimit) throw new DailyInboxAiLimitReachedError();
		db.prepare(
			`INSERT INTO inbox_ai_runs (id, document_id, provider_id, model_id, status, created_at)
			 VALUES (?, ?, ?, ?, 'RUNNING', ?)`
		).run(input.id, input.documentId, input.providerId, input.modelId, input.createdAt);
	});
	run.immediate();
};
export const markAiRunSucceeded = (db: Database.Database, id: string): void => {
	db.prepare(
		"UPDATE inbox_ai_runs SET status = 'SUCCEEDED' WHERE id = ? AND status = 'RUNNING'"
	).run(id);
};
export const markAiRunFailed = (db: Database.Database, id: string): void => {
	db.prepare("UPDATE inbox_ai_runs SET status = 'FAILED' WHERE id = ? AND status = 'RUNNING'").run(
		id
	);
};
