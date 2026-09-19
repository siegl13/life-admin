-- Persisted suggestion sets. A run is one provider attempt for one
-- attachment. Nothing here is authoritative Item data: values become Item
-- data only when the user accepts them and applyExtractionRun writes them
-- to cycle_fields through the existing field-update/recalculation path.
-- Deliberately NOT stored: the document bytes (already in the attachments
-- store) and the raw model response (data minimization).
--
-- RUNNING exists before the outbound provider call completes, so a failed
-- or crash-abandoned attempt still counts toward the rolling daily limit
-- (see extractionRepository.claimRun). reviewed_at is set only once the
-- run reaches a reviewed terminal state (APPLIED or DISMISSED).
CREATE TABLE extraction_runs (
  id              TEXT PRIMARY KEY,
  item_id         TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  cycle_id        TEXT NOT NULL REFERENCES cycles (id) ON DELETE CASCADE,
  -- Nullable, ON DELETE SET NULL (not CASCADE): a counted attempt must
  -- survive its attachment being deleted, or the rolling 24h daily cap
  -- (see ix_extraction_runs_created_at) could be reset by delete-and-
  -- re-upload. The run row, and therefore its count, is never removed by
  -- an attachment deletion (see review round-02 finding 1).
  attachment_id   TEXT REFERENCES attachments (id) ON DELETE SET NULL,
  provider_id     TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('RUNNING', 'NEW', 'FAILED', 'APPLIED', 'DISMISSED')),
  suggested_count INTEGER NOT NULL DEFAULT 0,
  discarded_count INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  reviewed_at     TEXT,
  CHECK ((status IN ('APPLIED', 'DISMISSED')) = (reviewed_at IS NOT NULL))
);
-- Rolling 24h attempt count scans by created_at regardless of status.
CREATE INDEX ix_extraction_runs_created_at ON extraction_runs (created_at);
-- Pending-run lookup and Item/Cycle review lookup both filter by cycle+status.
CREATE INDEX ix_extraction_runs_cycle_status ON extraction_runs (cycle_id, status, created_at);

CREATE TABLE extraction_suggestions (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES extraction_runs (id) ON DELETE CASCADE,
  field_key  TEXT NOT NULL,
  value      TEXT NOT NULL,
  position   INTEGER NOT NULL,
  accepted   INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0, 1)),
  UNIQUE (run_id, field_key)
);

-- First production consumer of app_settings. Non-secret keys only:
-- ai.enabled ('0'/'1') and ai.instruction (free text, max 1000 chars,
-- enforced in application/ai/aiSettings.ts).
