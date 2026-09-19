import type { DocumentExtractionProviderPort } from '$lib/application/ai/extraction';
import type { DocumentRoutingProviderPort } from '$lib/application/ai/routing';
import { config } from '../config';
import { log } from '../log';
import { fakeProvider } from './fakeProvider';
import { createOpenAiProvider } from './openaiProvider';

/**
 * Pure over `process.env`, so the production gate is unit-tested rather
 * than argued about. Two conditions must both hold for the fake to be
 * selected, and the Dockerfile sets `ENV NODE_ENV=production` in the
 * runtime stage, so a shipped container ignores the flag even if someone
 * sets it — and logs that it did (see B104).
 */
export function selectProvider(
	env: NodeJS.ProcessEnv
): DocumentExtractionProviderPort & DocumentRoutingProviderPort {
	const fakeRequested = env.LIFEADMIN_AI_FAKE === '1';
	const isProduction = env.NODE_ENV === 'production';

	if (fakeRequested && !isProduction) {
		log.warn('ai: using the FAKE extraction provider, no document leaves this machine');
		return fakeProvider;
	}
	if (fakeRequested && isProduction) {
		log.warn('ai: LIFEADMIN_AI_FAKE ignored because NODE_ENV=production');
	}
	return createOpenAiProvider(config);
}
