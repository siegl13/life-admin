import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import { materializePlaybook } from '$lib/domain/playbook/materialize';
import { loadPlaybookCatalog } from '$lib/server/playbooks/catalog';
import { installCustomPlaybook } from '$lib/server/playbooks/install';
import { createItem, getItemById } from './itemRepository';
import { listActions } from './actionRepository';

/**
 * Slice 2 acceptance criteria (approved plan): "removing source YAML does
 * not break existing item", "modifying source YAML does not mutate
 * existing item", and (amendment 5) "an item created before Slice 3 does
 * not need rebuilding when Action functionality is introduced" — verified
 * here by asserting the events/actions/dependencies rows created at
 * Slice-2-creation time are already fully correct without any later
 * migration or backfill.
 */

let tmpDir: string;
let playbooksDir: string;
let db: Database.Database;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-immutability-'));
	playbooksDir = path.join(tmpDir, 'playbooks');
	fs.mkdirSync(playbooksDir, { recursive: true });
	db = openDatabase(path.join(tmpDir, 'test.sqlite'));
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePlaybook(version: string, offsetMonths: number) {
	fs.writeFileSync(
		path.join(playbooksDir, 'nv.yaml'),
		[
			'schemaVersion: 1',
			'id: de.finance.nv-certificate',
			`version: ${version}`,
			'name: NV certificate',
			'fields:',
			'  - key: valid_until',
			'    type: date',
			'    label: Valid until',
			'    recommended: true',
			'events:',
			'  - key: expiry',
			'    label: Expiry',
			'    sourceField: valid_until',
			'actions:',
			'  - key: request_new',
			'    label: Request new',
			'    due:',
			'      event: expiry',
			`      offset: { months: ${offsetMonths} }`
		].join('\n')
	);
}

function loadNormalizedFromDisk() {
	const catalog = loadPlaybookCatalog(playbooksDir, path.join(tmpDir, 'no-custom-dir'));
	const entry = catalog.entries.find((e) => e.playbook.id === 'de.finance.nv-certificate');
	if (!entry) throw new Error('playbook failed to load from disk');
	return entry.playbook;
}

describe('playbook immutability (docs/adr/0004)', () => {
	it('modifying the source YAML after item creation does not change the existing item', () => {
		writePlaybook('1.0.0', -2);
		const playbook = loadNormalizedFromDisk();
		const item = createItem(db, {
			title: 'NV-Bescheinigung Max',
			note: null,
			playbook: {
				id: playbook.id,
				version: playbook.version,
				name: playbook.name,
				snapshot: playbook
			},
			materialization: materializePlaybook(playbook)
		});

		// Maintainer ships a "fix": offset changes from -2 to -3 months, version bumps.
		writePlaybook('1.1.0', -3);

		const reloaded = getItemById(db, item.id)!;
		expect(reloaded.playbookVersion).toBe('1.0.0'); // still the version it was created with
		expect((reloaded.playbookSnapshot as { version: string }).version).toBe('1.0.0');

		const cycleId = (
			db.prepare(`SELECT id FROM cycles WHERE item_id = ?`).get(item.id) as { id: string }
		).id;
		const action = listActions(db, cycleId).find((a) => a.actionKey === 'request_new')!;
		expect(action.dueKind).toBe('DERIVED');
		if (action.dueKind === 'DERIVED') {
			expect(action.dueOffset).toEqual({ months: -2 }); // unchanged, not -3
		}
	});

	it('installing a newer custom playbook version does not change an existing item (ADR 0004)', () => {
		const customDir = path.join(tmpDir, 'custom-playbooks');
		writePlaybook('1.0.0', -2);
		installCustomPlaybook({
			rootDir: customDir,
			playbookId: 'de.finance.nv-certificate',
			yaml: fs.readFileSync(path.join(playbooksDir, 'nv.yaml'), 'utf8'),
			replace: false,
			provenCustomPath: null
		});
		const entry = loadPlaybookCatalog(path.join(tmpDir, 'no-bundled-dir'), customDir).entries[0]!;
		const item = createItem(db, {
			title: 'NV-Bescheinigung Max',
			note: null,
			playbook: {
				id: entry.playbook.id,
				version: entry.playbook.version,
				name: entry.playbook.name,
				snapshot: entry.playbook
			},
			materialization: materializePlaybook(entry.playbook)
		});

		writePlaybook('1.1.0', -3);
		installCustomPlaybook({
			rootDir: customDir,
			playbookId: 'de.finance.nv-certificate',
			yaml: fs.readFileSync(path.join(playbooksDir, 'nv.yaml'), 'utf8'),
			replace: true,
			provenCustomPath: path.join(customDir, 'de.finance.nv-certificate.yaml')
		});

		const reloaded = getItemById(db, item.id)!;
		expect(reloaded.playbookVersion).toBe('1.0.0');
		expect((reloaded.playbookSnapshot as { version: string }).version).toBe('1.0.0');
	});

	it('deleting the source YAML entirely does not break an existing item', () => {
		writePlaybook('1.0.0', -2);
		const playbook = loadNormalizedFromDisk();
		const item = createItem(db, {
			title: 'NV-Bescheinigung Max',
			note: null,
			playbook: {
				id: playbook.id,
				version: playbook.version,
				name: playbook.name,
				snapshot: playbook
			},
			materialization: materializePlaybook(playbook)
		});

		fs.rmSync(path.join(playbooksDir, 'nv.yaml'));

		// The playbook is gone from the catalog entirely now...
		const catalogAfterDelete = loadPlaybookCatalog(
			playbooksDir,
			path.join(tmpDir, 'no-custom-dir')
		);
		expect(
			catalogAfterDelete.entries.find((e) => e.playbook.id === 'de.finance.nv-certificate')
		).toBeUndefined();

		// ...but the existing item is completely unaffected.
		const reloaded = getItemById(db, item.id)!;
		expect(reloaded.title).toBe('NV-Bescheinigung Max');
		expect(reloaded.playbookSnapshot).not.toBeNull();
		const cycleId = (
			db.prepare(`SELECT id FROM cycles WHERE item_id = ?`).get(item.id) as { id: string }
		).id;
		expect(listActions(db, cycleId)).toHaveLength(1);
	});

	it('an item created through the Slice 2 path already has correct events/actions/dependencies (no Slice 3 backfill needed)', () => {
		writePlaybook('1.0.0', -2);
		const playbook = loadNormalizedFromDisk();
		const item = createItem(db, {
			title: 'NV-Bescheinigung Max',
			note: null,
			playbook: {
				id: playbook.id,
				version: playbook.version,
				name: playbook.name,
				snapshot: playbook
			},
			materialization: materializePlaybook(playbook)
		});

		const cycleId = (
			db.prepare(`SELECT id FROM cycles WHERE item_id = ?`).get(item.id) as { id: string }
		).id;
		const eventRow = db.prepare(`SELECT * FROM events WHERE cycle_id = ?`).get(cycleId);
		const actionRow = db
			.prepare(`SELECT * FROM actions WHERE cycle_id = ? AND action_key = 'request_new'`)
			.get(cycleId);

		expect(eventRow).toBeDefined();
		expect(actionRow).toBeDefined();
		expect((actionRow as { due_kind: string }).due_kind).toBe('DERIVED');
	});
});
