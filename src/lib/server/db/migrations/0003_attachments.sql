CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  cycle_id TEXT REFERENCES cycles (id) ON DELETE SET NULL,
  filename TEXT NOT NULL CHECK (length(trim(filename)) > 0),
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  uploaded_at TEXT NOT NULL
);
CREATE INDEX ix_attachments_item ON attachments (item_id, uploaded_at DESC);
CREATE INDEX ix_attachments_cycle ON attachments (cycle_id);
