import Database from 'better-sqlite3';
import fs from 'node:fs';
import { config } from './config';
import { buildInfo } from './buildInfo';
import { listKnownMigrations } from './db/migrate';

export type CheckStatus = 'ok' | 'fail';

export interface HealthResponse {
	schemaVersion: 1;
	service: 'life-admin';
	status: 'ok' | 'degraded' | 'fail';
	version: string;
	revision: string;
	checks: {
		database: { status: CheckStatus; required: true };
		schema: { status: CheckStatus; required: true };
		storage: { status: CheckStatus; required: true };
	};
}

function databaseChecks(): { database: CheckStatus; schema: CheckStatus } {
	let db: Database.Database | undefined;
	try {
		if (!fs.existsSync(config.databasePath)) return { database: 'fail', schema: 'fail' };
		const openedDb = new Database(config.databasePath, { readonly: true, fileMustExist: true });
		db = openedDb;
		openedDb.prepare('SELECT 1').get();
		const applied = openedDb
			.prepare('SELECT version FROM schema_migrations ORDER BY version')
			.all()
			.map((row) => (row as { version: string }).version);
		const required = listKnownMigrations();
		const presentTables = new Set(
			(
				openedDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
					name: string;
				}[]
			).map((row) => row.name)
		);
		const appliedSet = new Set(applied);
		const tablesExist = [
			'schema_migrations',
			'items',
			'cycles',
			'cycle_fields',
			'events',
			'actions',
			'action_dependencies',
			'attachments',
			'inbox_documents',
			'notification_deliveries'
		].every((table) => presentTables.has(table));
		const requiredColumns: Record<string, string[]> = {
			schema_migrations: ['version', 'applied_at'],
			items: ['id', 'title', 'status'],
			cycles: ['id', 'item_id', 'sequence', 'status'],
			cycle_fields: ['id', 'cycle_id', 'field_key', 'value'],
			events: ['id', 'cycle_id', 'event_key'],
			actions: ['id', 'cycle_id', 'action_key', 'state'],
			action_dependencies: ['action_id', 'depends_on_action_id'],
			attachments: ['id', 'item_id', 'storage_key'],
			inbox_documents: ['id', 'storage_key'],
			notification_deliveries: ['id', 'action_id', 'status']
		};
		const columnsExist = Object.entries(requiredColumns).every(([table, columns]) => {
			const presentColumns = new Set(
				(openedDb.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(
					(column) => column.name
				)
			);
			return columns.every((column) => presentColumns.has(column));
		});
		const schemaOk =
			tablesExist && columnsExist && required.every((version) => appliedSet.has(version));
		return { database: 'ok', schema: schemaOk ? 'ok' : 'fail' };
	} catch {
		return { database: 'fail', schema: 'fail' };
	} finally {
		db?.close();
	}
}

function storageCheck(): CheckStatus {
	try {
		for (const directory of [config.dataDir, config.attachmentsDir, config.inboxDir]) {
			fs.accessSync(directory, fs.constants.R_OK);
			if (!fs.statSync(directory).isDirectory()) return 'fail';
		}
		return 'ok';
	} catch {
		return 'fail';
	}
}

export function getHealth(): HealthResponse {
	const db = databaseChecks();
	const checks = {
		database: { status: db.database, required: true as const },
		schema: { status: db.schema, required: true as const },
		storage: { status: storageCheck(), required: true as const }
	};
	return {
		schemaVersion: 1,
		service: 'life-admin',
		status: Object.values(checks).every((check) => check.status === 'ok') ? 'ok' : 'fail',
		version: `git-${buildInfo.shortRevision}`,
		revision: buildInfo.revision,
		checks
	};
}

export function getLiveHealth(): { status: 'ok' } {
	return { status: 'ok' };
}

export function getReadyHealth(): { status: 'ok' | 'fail' } {
	return { status: getHealth().status === 'ok' ? 'ok' : 'fail' };
}
