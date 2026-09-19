CREATE TABLE users (
	id TEXT PRIMARY KEY,
	username TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(username)) > 0),
	password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
	-- Deliberately no CHECK. Slice 12 adds MEMBER without rebuilding this table.
	role TEXT NOT NULL DEFAULT 'OWNER',
	failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
	locked_until TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	password_changed_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_users_username ON users (username);
CREATE UNIQUE INDEX ux_users_single_owner ON users (role) WHERE role = 'OWNER';

CREATE TABLE sessions (
	-- The key is SHA-256 of the cookie token. Raw tokens are never stored.
	token_hash TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	created_at TEXT NOT NULL,
	last_seen_at TEXT NOT NULL,
	expires_at TEXT NOT NULL
);
CREATE INDEX ix_sessions_user ON sessions (user_id);
CREATE INDEX ix_sessions_expires ON sessions (expires_at);
