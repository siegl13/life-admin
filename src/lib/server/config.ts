import path from 'node:path';

/**
 * All runtime configuration in one place, read once from the environment.
 * Nothing here reaches out to the network: Life Admin's core functionality
 * works fully offline (see the approved plan, "core must work offline").
 */
export interface Config {
	/** Directory for the SQLite file and the custom playbooks folder. */
	dataDir: string;
	/** Path to the SQLite database file. */
	databasePath: string;
	/** Directory custom (user-authored) playbooks are loaded from. */
	customPlaybooksDir: string;
	/** Directory bundled playbooks are loaded from. */
	bundledPlaybooksDir: string;
	port: number;
	origin: string | null;
	cookieSecure: boolean;
	backupsDir: string;
	restoreStagingDir: string;
	attachmentsDir: string;
	attachmentsTmpDir: string;
	inboxDir: string;
	inboxTmpDir: string;
	/** From LIFEADMIN_OPENAI_API_KEY. Never returned from a load function,
	 *  never written to the database, never logged — read here once and
	 *  touched only by server/ai/openaiProvider.ts after this. Every
	 *  provider-neutral caller (routes, use cases) checks
	 *  `aiCredentialConfigured` instead, never this field directly — see
	 *  the roadmap's provider-naming boundary and review round-02 finding
	 *  10. */
	openaiApiKey: string | null;
	/** Provider-neutral `openaiApiKey !== null`. The one value a
	 *  provider-independent route or use case is allowed to read to decide
	 *  whether AI extraction can be enabled/attempted at all — it carries
	 *  no provider name and no secret. */
	aiCredentialConfigured: boolean;
	/** From LIFEADMIN_AI_MODEL, defaulting to DEFAULT_AI_MODEL. A wrong
	 *  model name is passed through as-is and surfaces as a normal failed
	 *  extraction, never a silent fallback. */
	aiModel: string;
	aiTimeoutMs: number;
	aiMaxDocumentBytes: number;
	aiMaxOutputTokens: number;
	aiDailyRunLimit: number;
}

/** A general multimodal model, chosen for current (2026) PDF + image
 *  support via the Responses API. See docs/implementation-status.md,
 *  Slice 9, for the dated research evidence behind this choice and its
 *  one operator escape hatch, LIFEADMIN_AI_MODEL. (Updated 2026-09-11: the
 *  previous default, `gpt-5-mini`, no longer appears in OpenAI's current
 *  model listing; `gpt-5.6-terra` is both a currently listed model and
 *  the officially documented replacement for the retiring
 *  `gpt-5-mini-2025-08-07` snapshot.) */
const DEFAULT_AI_MODEL = 'gpt-5.6-terra';

function readConfig(env: NodeJS.ProcessEnv): Config {
	const openaiApiKey = env.LIFEADMIN_OPENAI_API_KEY?.trim() || null;
	const origin = env.ORIGIN?.trim().replace(/\/$/, '') || null;
	const dataDir = env.LIFEADMIN_DATA_DIR?.trim() || './.data';
	const bundledPlaybooksDir =
		env.PLAYBOOKS_BUNDLED_DIR?.trim() || path.join(process.cwd(), 'playbooks', 'bundled');
	const port = Number.parseInt(env.PORT ?? '3000', 10);
	const secureOverride = env.LIFEADMIN_COOKIE_SECURE?.trim().toLowerCase();
	const cookieSecure =
		secureOverride === 'true'
			? true
			: secureOverride === 'false'
				? false
				: (env.ORIGIN?.trim().toLowerCase().startsWith('https://') ?? false);

	return {
		dataDir,
		databasePath: path.join(dataDir, 'lifeadmin.sqlite'),
		customPlaybooksDir: path.join(dataDir, 'playbooks'),
		bundledPlaybooksDir,
		port: Number.isFinite(port) && port > 0 ? port : 3000,
		origin,
		cookieSecure,
		backupsDir: path.join(dataDir, 'backups'),
		restoreStagingDir: path.join(dataDir, 'restore'),
		attachmentsDir: path.join(dataDir, 'attachments'),
		attachmentsTmpDir: path.join(dataDir, 'attachments', '.tmp'),
		inboxDir: path.join(dataDir, 'inbox'),
		inboxTmpDir: path.join(dataDir, 'inbox', '.tmp'),
		openaiApiKey,
		aiCredentialConfigured: openaiApiKey !== null,
		aiModel: env.LIFEADMIN_AI_MODEL?.trim() || DEFAULT_AI_MODEL,
		aiTimeoutMs: 60_000,
		aiMaxDocumentBytes: 8 * 1024 * 1024,
		aiMaxOutputTokens: 2000,
		aiDailyRunLimit: 20
	};
}

export const config: Config = readConfig(process.env);
