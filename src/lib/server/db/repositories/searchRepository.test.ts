import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import { ACTIVE_SOURCES_QUERY, listActiveSources } from './searchRepository';

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-search-repo-'));
	db = openDatabase(path.join(tmpDir, 'test.sqlite'));
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('listActiveSources', () => {
	it('uses a bounded query over 1,000 active item fixtures and returns an exact total', () => {
		const insertItem = db.prepare(
			`INSERT INTO items (id, title, status, created_at, updated_at) VALUES (?, ?, 'ACTIVE', ?, ?)`
		);
		const insertCycle = db.prepare(
			`INSERT INTO cycles (id, item_id, sequence, status, created_at) VALUES (?, ?, 1, 'ACTIVE', ?)`
		);
		const insertField = db.prepare(
			`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, recommended, position, value) VALUES (?, ?, ?, 'Kennzeichen', 'text', 'CUSTOM', 0, ?, ?)`
		);
		const insertAction = db.prepare(
			`INSERT INTO actions (id, cycle_id, action_key, label, state, due_kind, position, created_at) VALUES (?, ?, ?, ?, 'OPEN', 'NONE', ?, ?)`
		);
		const now = '2026-09-14T00:00:00.000Z';
		db.transaction(() => {
			for (let index = 0; index < 1_000; index++) {
				const itemId = `item-${index}`;
				const cycleId = `cycle-${index}`;
				insertItem.run(itemId, `Vertrag ${index}`, now, now);
				insertCycle.run(cycleId, itemId, now);
				for (let position = 0; position < 5; position++) {
					insertField.run(
						`field-${index}-${position}`,
						cycleId,
						`field-${position}`,
						position,
						position === 0 ? `DUPLIKAT-${index}` : `Andere Angabe ${position}`
					);
					insertAction.run(
						`action-${index}-${position}`,
						cycleId,
						`action-${position}`,
						position === 0 ? `DUPLIKAT prüfen ${index}` : `Andere Aufgabe ${position}`,
						position,
						now
					);
				}
			}
		})();

		// Warm the registered scalar functions before timing the bound statement.
		listActiveSources(db, 'duplikat', 20);
		const startedAt = performance.now();
		const results = listActiveSources(db, 'duplikat', 20);
		const elapsedMs = performance.now() - startedAt;
		expect(results).toHaveLength(20);
		expect(results[0]).toMatchObject({ total: 1_000, moreMatches: 1, sourceKind: 'FIELD' });
		expect(Number.isFinite(elapsedMs)).toBe(true);

		const plan = db
			.prepare(`EXPLAIN QUERY PLAN ${ACTIVE_SOURCES_QUERY}`)
			.all('duplikat', 'duplikat', 20) as { detail: string }[];
		const details = plan.map((row) => row.detail).join('\n');
		process.stdout.write(
			`Search repository 1,000-item fixture: ${elapsedMs.toFixed(2)} ms\n${details}\n`
		);
		expect(details).not.toMatch(/CARTESIAN/i);
		expect(details).toMatch(/SEARCH c USING (?:COVERING )?INDEX/i);
		expect(details).toMatch(/SEARCH f USING (?:COVERING )?INDEX/i);
		expect(details).toMatch(/SEARCH a USING (?:COVERING )?INDEX/i);
	});

	it('matches localized scalar displays and excludes archived items', () => {
		const now = '2026-09-14T00:00:00.000Z';
		db.prepare(
			`INSERT INTO items (id, title, status, created_at, updated_at) VALUES ('active', 'Aktiv', 'ACTIVE', ?, ?)`
		).run(now, now);
		db.prepare(
			`INSERT INTO cycles (id, item_id, sequence, status, created_at) VALUES ('cycle', 'active', 1, 'ACTIVE', ?)`
		).run(now);
		db.prepare(
			`INSERT INTO items (id, title, status, created_at, updated_at) VALUES ('archived', 'Archivierter Vertrag', 'ARCHIVED', ?, ?)`
		).run(now, now);
		db.prepare(
			`INSERT INTO cycles (id, item_id, sequence, status, created_at) VALUES ('archived-cycle', 'archived', 1, 'ACTIVE', ?)`
		).run(now);
		db.prepare(
			`INSERT INTO items (id, title, status, created_at, updated_at) VALUES ('completed', 'Abgeschlossener Vertrag', 'ACTIVE', ?, ?)`
		).run(now, now);
		db.prepare(
			`INSERT INTO cycles (id, item_id, sequence, status, created_at) VALUES ('completed-cycle', 'completed', 1, 'COMPLETED', ?)`
		).run(now);
		db.prepare(
			`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, recommended, position, value) VALUES ('date', 'cycle', 'date', 'Datum', 'date', 'CUSTOM', 0, 0, '2026-09-14')`
		).run();
		db.prepare(
			`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, recommended, position, value) VALUES ('currency', 'cycle', 'currency', 'Preis', 'currency', 'CUSTOM', 0, 1, '351.00 EUR')`
		).run();
		expect(listActiveSources(db, '14. september', 20)).toHaveLength(1);
		expect(listActiveSources(db, '351,00', 20)).toHaveLength(1);
		expect(listActiveSources(db, 'archivierter', 20)).toHaveLength(0);
		expect(listActiveSources(db, 'abgeschlossener', 20)).toHaveLength(0);
	});

	it('uses literal matching and searches canonical scalar and Action values, not field labels', () => {
		const now = '2026-09-14T00:00:00.000Z';
		db.prepare(
			`INSERT INTO items (id, title, status, created_at, updated_at) VALUES ('item', '100%_\\ Vertrag', 'ACTIVE', ?, ?)`
		).run(now, now);
		db.prepare(
			`INSERT INTO cycles (id, item_id, sequence, status, created_at) VALUES ('cycle', 'item', 1, 'ACTIVE', ?)`
		).run(now);
		db.prepare(
			`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, recommended, position, value) VALUES ('date', 'cycle', 'date', 'Nur Label', 'date', 'CUSTOM', 0, 0, '2026-09-14')`
		).run();
		db.prepare(
			`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, recommended, position, value) VALUES ('currency', 'cycle', 'currency', 'Preis', 'currency', 'CUSTOM', 0, 1, '351.00 EUR')`
		).run();
		db.prepare(
			`INSERT INTO actions (id, cycle_id, action_key, label, state, due_kind, position, created_at, completed_at) VALUES ('done', 'cycle', 'done', 'Erledigte Aufgabe', 'DONE', 'NONE', 0, ?, ?)`
		).run(now, now);

		expect(listActiveSources(db, '%_\\', 20)).toHaveLength(1);
		expect(listActiveSources(db, '2026-09-14', 20)).toHaveLength(1);
		expect(listActiveSources(db, '351.00 eur', 20)).toHaveLength(1);
		expect(listActiveSources(db, 'erledigte', 20)[0]).toMatchObject({ sourceKind: 'ACTION' });
		expect(listActiveSources(db, 'nur label', 20)).toHaveLength(0);
	});

	it('excludes item notes, events, attachment and extraction data, and pending Inbox rows', () => {
		const now = '2026-09-14T00:00:00.000Z';
		const hidden = 'Nicht durchsuchbarer Geheimwert';
		db.prepare(
			`INSERT INTO items (id, title, note, status, created_at, updated_at) VALUES ('item', 'Sichtbarer Vertrag', ?, 'ACTIVE', ?, ?)`
		).run(hidden, now, now);
		db.prepare(
			`INSERT INTO cycles (id, item_id, sequence, status, created_at) VALUES ('cycle', 'item', 1, 'ACTIVE', ?)`
		).run(now);
		db.prepare(
			`INSERT INTO events (id, cycle_id, event_key, label, source_field_key, position) VALUES ('event', 'cycle', 'event', ?, 'source', 0)`
		).run(hidden);
		db.prepare(
			`INSERT INTO attachments (id, item_id, cycle_id, filename, storage_key, mime_type, byte_size, sha256, uploaded_at) VALUES ('attachment', 'item', 'cycle', ?, 'attachment-key', 'application/pdf', 1, ?, ?)`
		).run(`${hidden}.pdf`, 'a'.repeat(64), now);
		db.prepare(
			`INSERT INTO extraction_runs (id, item_id, cycle_id, provider_id, model_id, status, created_at) VALUES ('run', 'item', 'cycle', 'fake', 'fake', 'NEW', ?)`
		).run(now);
		db.prepare(
			`INSERT INTO extraction_suggestions (id, run_id, field_key, value, position) VALUES ('suggestion', 'run', 'suggestion', ?, 0)`
		).run(hidden);
		db.prepare(
			`INSERT INTO extraction_additional_suggestions (id, run_id, suggested_label, suggested_type, value, position) VALUES ('additional', 'run', ?, 'text', ?, 0)`
		).run(hidden, hidden);
		db.prepare(
			`INSERT INTO inbox_documents (id, storage_key, filename, mime_type, byte_size, sha256, suggestion_json, status, created_at, updated_at) VALUES ('inbox', 'inbox-key', ?, 'application/pdf', 1, ?, ?, 'PENDING', ?, ?)`
		).run(`${hidden}.pdf`, 'b'.repeat(64), JSON.stringify({ title: hidden }), now, now);

		expect(listActiveSources(db, 'geheimwert', 20)).toHaveLength(0);
	});

	it('uses frozen type labels and deterministic source priority for an Item', () => {
		const now = '2026-09-14T00:00:00.000Z';
		const snapshot = JSON.stringify({
			schemaVersion: 1,
			id: 'de.test.search',
			version: '1.0.0',
			name: 'Changed live name',
			labelI18n: { de: 'Eingefrorener Typ' },
			description: null,
			locale: null,
			category: null,
			fields: [],
			events: [],
			actions: []
		});
		db.prepare(
			`INSERT INTO items (id, title, status, playbook_name, playbook_snapshot, created_at, updated_at) VALUES ('item', 'Gemeinsamer Wert', 'ACTIVE', 'Veralteter Typ', ?, ?, ?)`
		).run(snapshot, now, now);
		db.prepare(
			`INSERT INTO cycles (id, item_id, sequence, status, created_at) VALUES ('cycle', 'item', 1, 'ACTIVE', ?)`
		).run(now);
		db.prepare(
			`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, recommended, position, value) VALUES ('field', 'cycle', 'shared', 'Wert', 'text', 'CUSTOM', 0, 0, 'Gemeinsamer Wert')`
		).run();

		expect(listActiveSources(db, 'eingefrorener', 20)[0]).toMatchObject({ sourceKind: 'TYPE' });
		expect(listActiveSources(db, 'gemeinsamer', 20)[0]).toMatchObject({
			sourceKind: 'TITLE',
			moreMatches: 1
		});
	});

	it('uses stable source and Item ordering for equal-priority matches', () => {
		const now = '2026-09-14T00:00:00.000Z';
		for (const [id, title] of [
			['item-b', 'Gemeinsamer Titel B'],
			['item-a', 'Gemeinsamer Titel A']
		]) {
			db.prepare(
				`INSERT INTO items (id, title, status, created_at, updated_at) VALUES (?, ?, 'ACTIVE', ?, ?)`
			).run(id, title, now, now);
			db.prepare(
				`INSERT INTO cycles (id, item_id, sequence, status, created_at) VALUES (?, ?, 1, 'ACTIVE', ?)`
			).run(`cycle-${id}`, id, now);
		}
		db.prepare(
			`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, recommended, position, value) VALUES ('field-beta', 'cycle-item-a', 'beta', 'Beta', 'text', 'CUSTOM', 0, 0, 'Gleicher Feldwert')`
		).run();
		db.prepare(
			`INSERT INTO cycle_fields (id, cycle_id, field_key, label, type, origin, recommended, position, value) VALUES ('field-alpha', 'cycle-item-a', 'alpha', 'Alpha', 'text', 'CUSTOM', 0, 0, 'Gleicher Feldwert')`
		).run();
		db.prepare(
			`INSERT INTO actions (id, cycle_id, action_key, label, state, due_kind, position, created_at) VALUES ('action-beta', 'cycle-item-b', 'beta', 'Gleiche Aufgabe beta', 'OPEN', 'NONE', 0, ?)`
		).run(now);
		db.prepare(
			`INSERT INTO actions (id, cycle_id, action_key, label, state, due_kind, position, created_at) VALUES ('action-alpha', 'cycle-item-b', 'alpha', 'Gleiche Aufgabe alpha', 'OPEN', 'NONE', 0, ?)`
		).run(now);

		expect(listActiveSources(db, 'gleicher feldwert', 20)[0]).toMatchObject({
			itemId: 'item-a',
			fieldLabel: 'Alpha'
		});
		expect(listActiveSources(db, 'gleiche aufgabe', 20)[0]).toMatchObject({
			itemId: 'item-b',
			actionLabel: 'Gleiche Aufgabe alpha'
		});
		expect(listActiveSources(db, 'gemeinsamer titel', 20).map((row) => row.itemId)).toEqual([
			'item-a',
			'item-b'
		]);
	});
});
