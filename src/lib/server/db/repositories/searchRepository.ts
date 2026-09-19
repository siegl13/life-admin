import type Database from 'better-sqlite3';
import type { SearchSourceRow } from '$lib/application/ports';
import { parsePlaybookSnapshot } from '$lib/domain/playbook/snapshot';
import { resolveLabel } from '$lib/i18n';
import { formatCurrencyDisplay, formatDate } from '$lib/ui/format';

function normalizeSearchValue(value: string): string {
	return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function typeLabel(snapshot: string | null, fallback: string | null): string | null {
	if (!snapshot) return null;
	try {
		const parsed = parsePlaybookSnapshot(JSON.parse(snapshot));
		return parsed.ok ? resolveLabel(parsed.playbook.name, parsed.playbook.labelI18n) : fallback;
	} catch {
		return fallback;
	}
}

function displayedFieldValue(type: string | null, value: string | null): string | null {
	if (value === null) return null;
	if (type === 'date') return formatDate(value);
	if (type === 'currency') return formatCurrencyDisplay(value);
	return value;
}

/**
 * Match inside SQLite using deterministic JavaScript Unicode normalization.
 * `instr` has literal semantics, so `%`, `_`, and backslashes need no SQL
 * wildcard escaping and every query value remains bound.
 */
export const ACTIVE_SOURCES_QUERY = `
		WITH sources AS (
			SELECT i.id AS itemId, i.title, i.playbook_name AS playbookName, i.playbook_snapshot AS playbookSnapshot,
			       'TITLE' AS sourceKind, NULL AS fieldLabel, NULL AS fieldType, NULL AS value, NULL AS actionLabel, 0 AS sourceOrder, 0 AS position, '' AS stableKey, i.title AS canonicalValue, i.title AS displayValue
			FROM items i JOIN cycles c ON c.item_id = i.id AND c.status = 'ACTIVE' WHERE i.status = 'ACTIVE'
			UNION ALL
			SELECT i.id, i.title, i.playbook_name, i.playbook_snapshot,
			       'TYPE', NULL, NULL, NULL, NULL, 1, 0, '', search_type_label(i.playbook_snapshot, i.playbook_name), search_type_label(i.playbook_snapshot, i.playbook_name)
			FROM items i JOIN cycles c ON c.item_id = i.id AND c.status = 'ACTIVE' WHERE i.status = 'ACTIVE' AND i.playbook_snapshot IS NOT NULL
			UNION ALL
			SELECT i.id, i.title, i.playbook_name, i.playbook_snapshot,
			       'FIELD', f.label, f.type, f.value, NULL, 2, f.position, f.field_key, f.value, search_display_value(f.type, f.value)
			FROM items i JOIN cycles c ON c.item_id = i.id AND c.status = 'ACTIVE' JOIN cycle_fields f ON f.cycle_id = c.id WHERE i.status = 'ACTIVE' AND f.value IS NOT NULL
			UNION ALL
			SELECT i.id, i.title, i.playbook_name, i.playbook_snapshot,
			       'ACTION', NULL, NULL, NULL, a.label, 3, a.position, a.action_key, a.label, a.label
			FROM items i JOIN cycles c ON c.item_id = i.id AND c.status = 'ACTIVE' JOIN actions a ON a.cycle_id = c.id WHERE i.status = 'ACTIVE'
		), matching AS (
			SELECT * FROM sources
			WHERE instr(search_normalize(canonicalValue), ?) > 0
			   OR instr(search_normalize(displayValue), ?) > 0
		), ranked AS (
			SELECT *,
			       row_number() OVER (PARTITION BY itemId ORDER BY sourceOrder, position, stableKey) AS resultRank,
			       count(*) OVER (PARTITION BY itemId) - 1 AS moreMatches
			FROM matching
		)
		SELECT itemId, title, playbookName, playbookSnapshot, sourceKind, fieldLabel, fieldType, value, NULL AS actionId, actionLabel, sourceOrder, moreMatches, count(*) OVER () AS total
		FROM ranked
		WHERE resultRank = 1
		ORDER BY sourceOrder, search_normalize(title), itemId
		LIMIT ?
	`;

export function listActiveSources(
	db: Database.Database,
	query: string,
	limit: number
): SearchSourceRow[] {
	db.function('search_normalize', (value: string | null) =>
		value === null ? '' : normalizeSearchValue(value)
	);
	db.function('search_type_label', typeLabel);
	db.function('search_display_value', displayedFieldValue);
	return db.prepare(ACTIVE_SOURCES_QUERY).all(query, query, limit) as SearchSourceRow[];
}
