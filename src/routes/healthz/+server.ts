import { json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { getDb } from '$lib/server/db/database';
import { listAppliedMigrations } from '$lib/server/db/migrate';
import { loadPlaybookCatalog } from '$lib/server/playbooks/catalog';
import { isRestorePending } from '$lib/server/restoreState';

const startedAt = Date.now();

/**
 * Non-sensitive health information only: no file paths, no stack traces,
 * no environment values. Used by Docker's HEALTHCHECK and by operators
 * checking whether the app started cleanly and which playbooks loaded.
 */
export function GET({ locals }: { locals: App.Locals }) {
	if (isRestorePending()) return json({ status: 'restore-pending' }, { status: 503 });
	if (!locals.user) return json({ status: 'ok' });
	let dbOk = true;
	let migrations: string[] = [];
	try {
		const db = getDb();
		migrations = listAppliedMigrations(db);
	} catch {
		dbOk = false;
	}

	const catalog = loadPlaybookCatalog(config.bundledPlaybooksDir, config.customPlaybooksDir);

	return json({
		status: dbOk ? 'ok' : 'degraded',
		uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
		db: {
			ok: dbOk,
			migrationsApplied: migrations.length
		},
		playbooks: {
			bundledValid: catalog.counts.bundledValid,
			bundledInvalid: catalog.counts.bundledInvalid,
			customValid: catalog.counts.customValid,
			customInvalid: catalog.counts.customInvalid,
			errorCount: catalog.errors.length
		}
	});
}
