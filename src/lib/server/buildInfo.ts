import packageJson from '../../../package.json';

/**
 * Which exact artifact is running: the application version (package.json,
 * the single source of truth for it) and the Git commit it was built
 * from. The revision is never read from `.git` at runtime — the
 * container may not even contain Git — it is baked in as the
 * `APP_REVISION` build arg/env var by the Docker build (see Dockerfile),
 * itself supplied from `git rev-parse HEAD` (local test-image builds) or
 * `${{ github.sha }}` (GitHub Actions). A local `npm run dev`/`vite dev`
 * has no such build step, so it falls back to `local` rather than
 * failing startup.
 */
export interface BuildInfo {
	version: string;
	/** Full commit SHA, or `local` when none was injected. */
	revision: string;
	/** First 12 characters of `revision`, suitable for display. */
	shortRevision: string;
}

function readBuildInfo(env: NodeJS.ProcessEnv): BuildInfo {
	const revision = env.APP_REVISION?.trim() || 'local';
	return {
		version: packageJson.version,
		revision,
		shortRevision: revision === 'local' ? revision : revision.slice(0, 12)
	};
}

export const buildInfo: BuildInfo = readBuildInfo(process.env);
