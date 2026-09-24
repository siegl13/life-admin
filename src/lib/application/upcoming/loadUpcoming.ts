import { buildUpcoming, type UpcomingRange } from '../../domain/upcoming/upcoming';
import type { Clock, WhatsNextRepositoryPort } from '../ports';

/** Loads the existing active working set and projects its future orientation. */
export function loadUpcoming(ports: {
	whatsNext: WhatsNextRepositoryPort;
	clock: Clock;
}): UpcomingRange[] {
	return buildUpcoming(ports.whatsNext.loadItems(), ports.clock.todayIso());
}
