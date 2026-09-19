import type Database from 'better-sqlite3';
import type { Attachment, AttachmentMimeType } from '$lib/domain/attachment/attachment';
import { assertItemIsWritable } from './writeGuards';
type Row = {
	id: string;
	item_id: string;
	cycle_id: string | null;
	filename: string;
	display_name: string | null;
	storage_key: string;
	mime_type: string;
	byte_size: number;
	sha256: string;
	uploaded_at: string;
};
const map = (r: Row): Attachment => ({
	id: r.id,
	itemId: r.item_id,
	cycleId: r.cycle_id,
	filename: r.filename,
	displayName: r.display_name,
	storageKey: r.storage_key,
	mimeType: r.mime_type as AttachmentMimeType,
	byteSize: r.byte_size,
	sha256: r.sha256,
	uploadedAt: r.uploaded_at
});
export const listByItem = (db: Database.Database, id: string): Attachment[] =>
	(
		db
			.prepare('SELECT * FROM attachments WHERE item_id=? ORDER BY uploaded_at DESC,rowid DESC')
			.all(id) as Row[]
	).map(map);
export const listByCycle = (db: Database.Database, id: string): Attachment[] =>
	(
		db
			.prepare('SELECT * FROM attachments WHERE cycle_id=? ORDER BY uploaded_at DESC,rowid DESC')
			.all(id) as Row[]
	).map(map);
export function getById(db: Database.Database, id: string): Attachment | null {
	const r = db.prepare('SELECT * FROM attachments WHERE id=?').get(id) as Row | undefined;
	return r ? map(r) : null;
}
export const countByItem = (db: Database.Database, id: string): number =>
	(db.prepare('SELECT count(*) n FROM attachments WHERE item_id=?').get(id) as { n: number }).n;
/** Guarded by `assertItemIsWritable` inside the same transaction as the
 *  insert: an item archived while a slow upload was still streaming must
 *  not gain an attachment once the stream finally reaches this write
 *  (Slice 8 review, finding 2). Throws `ItemNotWritableError` (from
 *  ./writeGuards) rather than silently inserting. */
export function insert(db: Database.Database, r: Attachment): Attachment {
	return db.transaction(() => {
		assertItemIsWritable(db, r.itemId);
		db.prepare(
			'INSERT INTO attachments (id,item_id,cycle_id,filename,display_name,storage_key,mime_type,byte_size,sha256,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
		).run(
			r.id,
			r.itemId,
			r.cycleId,
			r.filename,
			r.displayName,
			r.storageKey,
			r.mimeType,
			r.byteSize,
			r.sha256,
			r.uploadedAt
		);
		return getById(db, r.id)!;
	})();
}
export function rename(
	db: Database.Database,
	itemId: string,
	id: string,
	displayName: string | null
): Attachment | null {
	return db.transaction(() => {
		const existing = getById(db, id);
		if (!existing || existing.itemId !== itemId) return null;
		assertItemIsWritable(db, itemId);
		db.prepare('UPDATE attachments SET display_name = ? WHERE id = ? AND item_id = ?').run(
			displayName,
			id,
			itemId
		);
		return getById(db, id);
	})();
}
/** Guarded the same way as {@link insert}: throws `ItemNotWritableError`
 *  without deleting anything when the owning item is not currently
 *  ACTIVE, so a caller never removes the on-disk file for a row that in
 *  fact survives (Slice 8 review, finding 2). Returns null only for a
 *  genuinely unknown id, matching the pre-existing "not found" contract. */
export function deleteById(db: Database.Database, id: string): Attachment | null {
	const existing = getById(db, id);
	if (!existing) return null;
	return db.transaction(() => {
		assertItemIsWritable(db, existing.itemId);
		db.prepare('DELETE FROM attachments WHERE id=?').run(id);
		return existing;
	})();
}
export const listStorageKeysForItem = (db: Database.Database, id: string): string[] =>
	(
		db.prepare('SELECT storage_key FROM attachments WHERE item_id=?').all(id) as {
			storage_key: string;
		}[]
	).map((r) => r.storage_key);
