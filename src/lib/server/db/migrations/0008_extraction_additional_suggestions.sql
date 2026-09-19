-- AI Extraction 1.1: administrative facts a document contains that the
-- current Item has no field for yet. Kept in its own table rather than
-- reusing extraction_suggestions (which is keyed by an existing
-- field_key) — an additional suggestion has no field yet, only a label
-- and a proposed type, until the user accepts it and a real CUSTOM field
-- is created (see application/ai/ports.ts, addAdditionalFields).
ALTER TABLE extraction_runs ADD COLUMN discarded_additional_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE extraction_additional_suggestions (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES extraction_runs (id) ON DELETE CASCADE,
  suggested_label TEXT NOT NULL,
  suggested_type  TEXT NOT NULL CHECK (suggested_type IN ('text', 'date', 'currency')),
  value           TEXT NOT NULL,
  position        INTEGER NOT NULL,
  accepted        INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0, 1))
);
CREATE INDEX ix_extraction_additional_suggestions_run ON extraction_additional_suggestions (run_id);
