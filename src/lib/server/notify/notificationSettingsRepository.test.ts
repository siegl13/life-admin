import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../db/database';
import * as settings from '../db/repositories/appSettingsRepository';
import { NOTIFY_KEYS } from '$lib/application/notify/notifySettings';
import {
	getDispatchNotificationSettings,
	getNotificationSettings,
	saveNotificationSettings
} from './notificationSettingsRepository';

let db: Database.Database;
let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-admin-notify-settings-'));
	db = openDatabase(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const save = (reminderTime: string) =>
	saveNotificationSettings(db, {
		enabled: true,
		channel: 'NTFY',
		baseUrl: 'https://ntfy.example',
		topic: 'private_topic',
		leadDays: 7,
		reminderTime,
		minimalContent: false,
		token: '',
		webhookUrl: '',
		removeToken: false,
		removeWebhook: false
	});

describe('notification reminder time persistence', () => {
	it('defaults an existing install without a stored value to the former 08:00', () => {
		expect(getNotificationSettings(db).reminderTime).toBe('08:00');
		settings.set(db, NOTIFY_KEYS.enabled, '1');
		expect(getDispatchNotificationSettings(db).reminderTime).toBe('08:00');
	});

	it('stores and returns the chosen time for the settings page and the dispatcher', () => {
		save('17:45');
		expect(getNotificationSettings(db).reminderTime).toBe('17:45');
		expect(getDispatchNotificationSettings(db).reminderTime).toBe('17:45');
	});

	it('reads a corrupt stored value as the default', () => {
		settings.set(db, NOTIFY_KEYS.reminderTime, '25:99');
		expect(getNotificationSettings(db).reminderTime).toBe('08:00');
	});
});
