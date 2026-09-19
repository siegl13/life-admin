import type Database from 'better-sqlite3';
import type { AccountUser, SessionRecord } from '$lib/application/ports';
import { nextLockout } from '$lib/domain/auth/lockout';

type UserRow = {
	id: string;
	username: string;
	password_hash: string;
	role: string;
	failed_login_count: number;
	locked_until: string | null;
};

function mapUser(row: UserRow): AccountUser {
	return {
		id: row.id,
		username: row.username,
		passwordHash: row.password_hash,
		role: row.role,
		failedLoginCount: row.failed_login_count,
		lockedUntil: row.locked_until
	};
}

export function ownerExists(db: Database.Database): boolean {
	return db.prepare("SELECT 1 FROM users WHERE role = 'OWNER'").get() !== undefined;
}

export function findByUsername(db: Database.Database, username: string): AccountUser | null {
	const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as
		UserRow | undefined;
	return row ? mapUser(row) : null;
}

export function findById(db: Database.Database, id: string): AccountUser | null {
	const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
	return row ? mapUser(row) : null;
}

export function createOwner(
	db: Database.Database,
	input: { id: string; username: string; passwordHash: string; nowIso: string }
): AccountUser {
	db.prepare(
		`INSERT INTO users
		 (id, username, password_hash, role, created_at, updated_at, password_changed_at)
		 VALUES (?, ?, ?, 'OWNER', ?, ?, ?)`
	).run(input.id, input.username, input.passwordHash, input.nowIso, input.nowIso, input.nowIso);
	return findById(db, input.id)!;
}

export function updatePasswordHash(
	db: Database.Database,
	userId: string,
	passwordHash: string,
	nowIso: string
): void {
	db.prepare(
		'UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?'
	).run(passwordHash, nowIso, nowIso, userId);
}

/**
 * Reads the current failure count and derives the new count/lockout inside
 * one transaction, rather than trusting a count computed earlier in the
 * application from a possibly-stale read: two concurrent callers must never
 * both compute "previous + 1" from the same starting value and have one
 * increment silently lost. `.immediate()` forces `BEGIN IMMEDIATE`, so the
 * write lock is acquired before the read below, not deferred until the
 * first write statement — closing the classic SQLite lost-update window
 * where two deferred transactions both read the old value before either
 * writes. This makes the guarantee hold even across two separate
 * connections (e.g. a future multi-process deployment sharing this file),
 * not only within one process — the in-process per-username lock
 * (application/auth/loginLock.ts) is a second, independent layer on top.
 */
export function recordFailedLogin(db: Database.Database, userId: string, nowIso: string): void {
	const run = db.transaction((id: string, now: string) => {
		const row = db.prepare('SELECT failed_login_count FROM users WHERE id = ?').get(id) as
			{ failed_login_count: number } | undefined;
		if (!row) return;
		const { failureCount, lockedUntil } = nextLockout(row.failed_login_count, now);
		db.prepare(
			'UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?'
		).run(failureCount, lockedUntil, now, id);
	});
	run.immediate(userId, nowIso);
}

export function clearFailedLogins(db: Database.Database, userId: string, nowIso: string): void {
	db.prepare(
		'UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?'
	).run(nowIso, userId);
}

type SessionRow = {
	token_hash: string;
	user_id: string;
	created_at: string;
	last_seen_at: string;
	expires_at: string;
};

function mapSession(row: SessionRow): SessionRecord {
	return {
		tokenHash: row.token_hash,
		userId: row.user_id,
		createdAt: row.created_at,
		lastSeenAt: row.last_seen_at,
		expiresAt: row.expires_at
	};
}

export function createSession(db: Database.Database, value: SessionRecord): void {
	db.prepare(
		'INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)'
	).run(value.tokenHash, value.userId, value.createdAt, value.lastSeenAt, value.expiresAt);
}

export function findSession(db: Database.Database, tokenHash: string): SessionRecord | null {
	const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash) as
		SessionRow | undefined;
	return row ? mapSession(row) : null;
}

export function touchSession(db: Database.Database, tokenHash: string, nowIso: string): void {
	db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(nowIso, tokenHash);
}

export function removeSession(db: Database.Database, tokenHash: string): void {
	db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function removeAllForUser(db: Database.Database, userId: string): void {
	db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function removeExpired(db: Database.Database, nowIso: string): number {
	return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso).changes;
}
