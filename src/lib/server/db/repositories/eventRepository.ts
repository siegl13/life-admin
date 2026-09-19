import type Database from 'better-sqlite3';
import type { Event } from '$lib/domain/event/event';

interface EventRow {
	id: string;
	cycle_id: string;
	event_key: string;
	label: string;
	source_field_key: string;
	resolved_date: string | null;
	position: number;
}

function mapEvent(row: EventRow): Event {
	return {
		id: row.id,
		cycleId: row.cycle_id,
		eventKey: row.event_key,
		label: row.label,
		sourceFieldKey: row.source_field_key,
		resolvedDate: row.resolved_date,
		position: row.position
	};
}

export function listEvents(db: Database.Database, cycleId: string): Event[] {
	const rows = db
		.prepare('SELECT * FROM events WHERE cycle_id = ? ORDER BY position')
		.all(cycleId) as EventRow[];
	return rows.map(mapEvent);
}
