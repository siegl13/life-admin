import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';

/**
 * `buildInfo` reads `process.env.APP_REVISION` once at module load, so it
 * can't be exercised with different env values without re-importing the
 * module — vitest's dynamic `import()` with `vi.resetModules()` gives each
 * case its own fresh module instance instead.
 */
async function loadBuildInfo(env: Record<string, string | undefined>) {
	const original = { ...process.env };
	delete process.env.APP_REVISION;
	Object.assign(process.env, env);
	const { vi } = await import('vitest');
	vi.resetModules();
	try {
		return await import('./buildInfo');
	} finally {
		process.env = original;
	}
}

describe('buildInfo', () => {
	it('exposes the application version from package.json', async () => {
		const { buildInfo } = await loadBuildInfo({});
		expect(buildInfo.version).toBe(packageJson.version);
	});

	it('exposes the full injected revision', async () => {
		const { buildInfo } = await loadBuildInfo({
			APP_REVISION: 'a83f21c5d4ef1234567890abcdef1234567890ab'
		});
		expect(buildInfo.revision).toBe('a83f21c5d4ef1234567890abcdef1234567890ab');
	});

	it('shortens the revision to 12 characters for display', async () => {
		const { buildInfo } = await loadBuildInfo({
			APP_REVISION: 'a83f21c5d4ef1234567890abcdef1234567890ab'
		});
		expect(buildInfo.shortRevision).toBe('a83f21c5d4ef');
		expect(buildInfo.shortRevision).toHaveLength(12);
	});

	it('falls back to "local" when no revision was injected (local dev)', async () => {
		const { buildInfo } = await loadBuildInfo({ APP_REVISION: undefined });
		expect(buildInfo.revision).toBe('local');
		expect(buildInfo.shortRevision).toBe('local');
	});

	it('falls back to "local" for a blank injected revision', async () => {
		const { buildInfo } = await loadBuildInfo({ APP_REVISION: '   ' });
		expect(buildInfo.revision).toBe('local');
	});
});
