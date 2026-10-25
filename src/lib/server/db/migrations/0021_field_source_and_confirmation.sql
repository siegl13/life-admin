-- Per-value provenance and confirmation (generic, not travel-specific).
-- source_text: a short exact excerpt, stored only when a value was applied
-- from an extraction suggestion that carried one. NULL for manual,
-- historical and evidence-less values, so no existing row gains provenance.
-- confirmed: explicit user confirmation of the current value. Every
-- existing value starts unconfirmed; nothing is backfilled.
ALTER TABLE cycle_fields
  ADD COLUMN source_text TEXT CHECK (source_text IS NULL OR length(source_text) BETWEEN 1 AND 300);
ALTER TABLE cycle_fields
  ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1));

ALTER TABLE extraction_suggestions
  ADD COLUMN source_text TEXT CHECK (source_text IS NULL OR length(source_text) BETWEEN 1 AND 300);
