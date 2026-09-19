-- Inbox routing attempts are retained independently of pending bytes. A user
-- cannot reset the rolling provider-call cap by deleting and re-uploading a file.
CREATE TABLE inbox_ai_runs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES inbox_documents (id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  created_at TEXT NOT NULL
);
CREATE INDEX ix_inbox_ai_runs_created_at ON inbox_ai_runs (created_at);
