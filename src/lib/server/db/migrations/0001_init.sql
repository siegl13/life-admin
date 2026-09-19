-- Life Admin: complete initial schema.
--
-- A single migration on purpose: items are fully materialized (fields,
-- events, actions, dependencies) from the day they are created, even
-- though the UI exposes actions only from Slice 3 onward. This means no
-- later migration ever needs to backfill or rebuild existing items.

CREATE TABLE schema_migrations (
	version    TEXT PRIMARY KEY,
	applied_at TEXT NOT NULL
);

CREATE TABLE app_settings (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE items (
	id                TEXT PRIMARY KEY,
	title             TEXT NOT NULL CHECK (length(trim(title)) > 0),
	note              TEXT,
	status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
	playbook_id       TEXT,
	playbook_version  TEXT,
	playbook_name     TEXT,
	playbook_snapshot TEXT,
	created_at        TEXT NOT NULL,
	updated_at        TEXT NOT NULL
);

CREATE TABLE cycles (
	id         TEXT PRIMARY KEY,
	item_id    TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
	sequence   INTEGER NOT NULL DEFAULT 1,
	status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED')),
	created_at TEXT NOT NULL,
	UNIQUE (item_id, sequence)
);

-- At most one ACTIVE cycle per item.
CREATE UNIQUE INDEX ux_cycles_single_active ON cycles (item_id) WHERE status = 'ACTIVE';
CREATE INDEX ix_cycles_item_status ON cycles (item_id, status);

CREATE TABLE cycle_fields (
	id          TEXT PRIMARY KEY,
	cycle_id    TEXT NOT NULL REFERENCES cycles (id) ON DELETE CASCADE,
	field_key   TEXT NOT NULL,
	label       TEXT NOT NULL,
	type        TEXT NOT NULL CHECK (type IN ('text', 'date')),
	origin      TEXT NOT NULL CHECK (origin IN ('PLAYBOOK', 'CUSTOM')),
	recommended INTEGER NOT NULL DEFAULT 0 CHECK (recommended IN (0, 1)),
	position    INTEGER NOT NULL,
	value       TEXT,
	UNIQUE (cycle_id, field_key)
);

CREATE INDEX ix_cycle_fields_cycle_position ON cycle_fields (cycle_id, position);

CREATE TABLE events (
	id               TEXT PRIMARY KEY,
	cycle_id         TEXT NOT NULL REFERENCES cycles (id) ON DELETE CASCADE,
	event_key        TEXT NOT NULL,
	label            TEXT NOT NULL,
	source_field_key TEXT NOT NULL,
	resolved_date    TEXT,
	position         INTEGER NOT NULL,
	UNIQUE (cycle_id, event_key)
);

CREATE INDEX ix_events_cycle ON events (cycle_id);

CREATE TABLE actions (
	id            TEXT PRIMARY KEY,
	cycle_id      TEXT NOT NULL REFERENCES cycles (id) ON DELETE CASCADE,
	action_key    TEXT NOT NULL,
	label         TEXT NOT NULL,
	description   TEXT,
	state         TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'DONE', 'SKIPPED')),
	due_kind      TEXT NOT NULL CHECK (due_kind IN ('NONE', 'DERIVED', 'MANUAL')),
	due_event_key TEXT,
	due_offset    TEXT,
	due_date      TEXT,
	position      INTEGER NOT NULL,
	created_at    TEXT NOT NULL,
	completed_at  TEXT,
	UNIQUE (cycle_id, action_key),
	CHECK ((due_kind = 'DERIVED') = (due_event_key IS NOT NULL)),
	CHECK (due_kind <> 'NONE' OR due_date IS NULL),
	CHECK (due_kind <> 'MANUAL' OR due_offset IS NULL),
	CHECK ((state = 'OPEN') = (completed_at IS NULL))
);

CREATE INDEX ix_actions_cycle_state ON actions (cycle_id, state);

CREATE TABLE action_dependencies (
	action_id            TEXT NOT NULL REFERENCES actions (id) ON DELETE CASCADE,
	depends_on_action_id TEXT NOT NULL REFERENCES actions (id) ON DELETE CASCADE,
	PRIMARY KEY (action_id, depends_on_action_id),
	CHECK (action_id <> depends_on_action_id)
);
