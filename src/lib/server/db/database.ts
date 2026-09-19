import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { log } from '../log';
import { runMigrations } from './migrate';
import { isRestorePending } from '../restoreState';

export class DatabaseClosedForRestoreError extends Error {}

/**
 * Opens (creating if necessary) a SQLite database at the given path,
 * applies the startup pragmas required by the plan, and runs any pending
 * migrations. Used both for the app's single long-lived connection and
 * for isolated per-test databases (":memory:" or a temp file).
 */
export function openDatabase(filePath: string): Database.Database {
	if (filePath !== ':memory:') {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
	}

	const db = new Database(filePath);
	// Order matters: foreign_keys and journal_mode must be set outside any
	// transaction to take effect.
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	db.pragma('synchronous = NORMAL');
	db.pragma('busy_timeout = 5000');

	const { applied } = runMigrations(db);
	if (applied.length > 0) {
		log.info('applied database migrations', { applied });
	}

	return db;
}

let singleton: Database.Database | null = null;

/** The application's single shared database connection. */
export function getDb(): Database.Database {
	if (isRestorePending()) throw new DatabaseClosedForRestoreError('Database closed for restore');
	if (!singleton) {
		singleton = openDatabase(config.databasePath);
	}
	return singleton;
}

export function closeDb(): void {
	singleton?.close();
	singleton = null;
}
