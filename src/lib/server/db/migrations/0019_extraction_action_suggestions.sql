-- Document Action Suggestions: user-facing next steps a document implies.
-- Kept in their own table (not extraction_suggestions, which is keyed by an
-- existing field_key). A row never becomes an Action by itself: the user
-- selects it on the review page and only then an ordinary MANUAL action is
-- created. Date semantics are stored as the model reported them; the
-- concrete date is calculated deterministically at review/accept time.
CREATE TABLE extraction_action_suggestions (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES extraction_runs (id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  context         TEXT,
  evidence        TEXT,
  date_kind       TEXT NOT NULL CHECK (date_kind IN ('DUE_BY', 'AVAILABLE_FROM', 'ON_DATE', 'APPROXIMATE', 'NONE')),
  date_value      TEXT,
  rel_relation    TEXT CHECK (rel_relation IN ('BEFORE', 'AFTER')),
  rel_amount      INTEGER CHECK (rel_amount IS NULL OR rel_amount > 0),
  rel_unit        TEXT CHECK (rel_unit IN ('DAYS', 'WEEKS', 'MONTHS', 'YEARS')),
  rel_anchor_key  TEXT,
  rel_anchor_date TEXT,
  rel_anchor_label TEXT,
  position        INTEGER NOT NULL,
  accepted        INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0, 1)),
  CHECK (
    (rel_relation IS NULL AND rel_amount IS NULL AND rel_unit IS NULL
      AND rel_anchor_key IS NULL AND rel_anchor_date IS NULL AND rel_anchor_label IS NULL)
    OR (rel_relation IS NOT NULL AND rel_amount IS NOT NULL AND rel_unit IS NOT NULL
      AND (rel_anchor_key IS NOT NULL
        OR (rel_anchor_date IS NOT NULL AND rel_anchor_label IS NOT NULL)))
  )
);
CREATE INDEX ix_extraction_action_suggestions_run ON extraction_action_suggestions (run_id);

ALTER TABLE extraction_runs ADD COLUMN discarded_action_count INTEGER NOT NULL DEFAULT 0;
