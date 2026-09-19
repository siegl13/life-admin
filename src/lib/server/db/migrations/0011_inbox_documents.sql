CREATE TABLE inbox_documents (
  id TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL CHECK (length(trim(filename)) > 0),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  suggestion_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ROUTING')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_inbox_documents_status ON inbox_documents (status, created_at DESC);
