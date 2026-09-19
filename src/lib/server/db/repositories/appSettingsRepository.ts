import type Database from 'better-sqlite3';

/** Settings are plain strings. UI-entered secrets use the `secret.` prefix so
 * backup sanitization excludes them; callers must never return their values
 * from a load function. */
export function get(db: Database.Database, key: string): string | null {
	const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
		{ value: string } | undefined;
	return row?.value ?? null;
}

export function set(db: Database.Database, key: string, value: string): void {
	db.prepare(
		'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
	).run(key, value);
}

export function remove(db: Database.Database, key: string): void {
	db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}
