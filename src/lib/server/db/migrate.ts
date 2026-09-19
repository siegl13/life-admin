import type Database from 'better-sqlite3';

// Migration SQL is inlined into the bundle at build time (Vite's `?raw`
// import query), so migration files can never go missing from a built
// Docker image the way files copied separately could.
const migrationModules = import.meta.glob('./migrations/*.sql', {
	eager: true,
	query: '?raw',
	import: 'default'
}) as Record<string, string>;

export interface MigrationResult {
	applied: string[];
}

function tableExists(db: Database.Database, name: string): boolean {
	const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
	return row !== undefined;
}

function versionOf(modulePath: string): string {
	const file = modulePath.split('/').pop() ?? modulePath;
	return file.replace(/\.sql$/, '');
}

/**
 * Applies every migration under ./migrations that has not yet been
 * recorded in schema_migrations, in filename order, each inside its own
 * transaction. Safe to call on every startup: already-applied migrations
 * are skipped.
 */
export function runMigrations(db: Database.Database): MigrationResult {
	const applied: string[] = [];
	const paths = Object.keys(migrationModules).sort();

	for (const modulePath of paths) {
		const version = versionOf(modulePath);
		const migrationsTableReady = tableExists(db, 'schema_migrations');
		const alreadyApplied = migrationsTableReady
			? db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version) !== undefined
			: false;
		if (alreadyApplied) continue;

		const sql = migrationModules[modulePath];
		const applyMigration = db.transaction(() => {
			db.exec(sql);
			db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
				version,
				new Date().toISOString()
			);
		});
		applyMigration();
		applied.push(version);
	}

	return { applied };
}

export function listAppliedMigrations(db: Database.Database): string[] {
	if (!tableExists(db, 'schema_migrations')) return [];
	return db
		.prepare('SELECT version FROM schema_migrations ORDER BY version')
		.all()
		.map((row) => (row as { version: string }).version);
}

export function listKnownMigrations(): string[] {
	return Object.keys(migrationModules).sort().map(versionOf);
}
