import { buildWhatsNext, type WhatsNextGroup } from '../../domain/whatsnext/whatsNext';
import type { Clock, WhatsNextRepositoryPort } from '../ports';

/**
 * The primary product screen: "what do I need to do next, and when?".
 * All ranking/grouping/availability logic lives in the pure domain
 * function (domain/whatsnext/whatsNext.ts) — this use case only loads
 * the working set and today's date.
 */
export function getWhatsNext(ports: {
	whatsNext: WhatsNextRepositoryPort;
	clock: Clock;
}): WhatsNextGroup[] {
	return buildWhatsNext(ports.whatsNext.loadItems(), ports.clock.todayIso());
}
