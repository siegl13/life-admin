-- Widen cycle_fields.type to accept 'currency' (AI Extraction 1.1 / the
-- generic Field type system, not a domain-specific concept — see
-- docs/adr/0012). SQLite has no ALTER TABLE for CHECK constraints, so the
-- table is rebuilt: nothing else references cycle_fields by foreign key,
-- and every existing row's cycle_id still points at an unchanged cycles
-- row, so this is safe under the same transaction every other migration
-- already runs in (see migrate.ts).
CREATE TABLE cycle_fields_new (
  id          TEXT PRIMARY KEY,
  cycle_id    TEXT NOT NULL REFERENCES cycles (id) ON DELETE CASCADE,
  field_key   TEXT NOT NULL,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('text', 'date', 'currency')),
  origin      TEXT NOT NULL CHECK (origin IN ('PLAYBOOK', 'CUSTOM')),
  recommended INTEGER NOT NULL DEFAULT 0 CHECK (recommended IN (0, 1)),
  position    INTEGER NOT NULL,
  value       TEXT,
  UNIQUE (cycle_id, field_key)
);

INSERT INTO cycle_fields_new
  SELECT id, cycle_id, field_key, label, type, origin, recommended, position, value
  FROM cycle_fields;

DROP TABLE cycle_fields;
ALTER TABLE cycle_fields_new RENAME TO cycle_fields;

CREATE INDEX ix_cycle_fields_cycle_position ON cycle_fields (cycle_id, position);
