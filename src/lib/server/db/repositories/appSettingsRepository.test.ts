import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import { get, set } from './appSettingsRepository';

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-app-settings-'));
	db = openDatabase(path.join(tmpDir, 'test.sqlite'));
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('appSettingsRepository', () => {
	it('returns null for a key that was never set', () => {
		expect(get(db, 'ai.enabled')).toBeNull();
	});

	it('round-trips a set value', () => {
		set(db, 'ai.enabled', '1');
		expect(get(db, 'ai.enabled')).toBe('1');
	});

	it('upserts: setting an existing key again overwrites it, not a second row', () => {
		set(db, 'ai.instruction', 'first');
		set(db, 'ai.instruction', 'second');
		expect(get(db, 'ai.instruction')).toBe('second');
		const row = db
			.prepare('SELECT COUNT(*) n FROM app_settings WHERE key = ?')
			.get('ai.instruction') as { n: number };
		expect(row.n).toBe(1);
	});
});
