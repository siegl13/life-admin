-- Inbox rows are temporary. Counted provider attempts must outlive their
-- removal, otherwise delete-and-re-upload bypasses the rolling call limit.
CREATE TABLE inbox_ai_runs_new (
  id TEXT PRIMARY KEY,
  document_id TEXT REFERENCES inbox_documents (id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  created_at TEXT NOT NULL
);
INSERT INTO inbox_ai_runs_new (id, document_id, provider_id, model_id, status, created_at)
  SELECT id, document_id, provider_id, model_id, status, created_at FROM inbox_ai_runs;
DROP TABLE inbox_ai_runs;
ALTER TABLE inbox_ai_runs_new RENAME TO inbox_ai_runs;
CREATE INDEX ix_inbox_ai_runs_created_at ON inbox_ai_runs (created_at);
