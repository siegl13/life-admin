CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  action_id TEXT NOT NULL REFERENCES actions (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('DUE_SOON', 'OVERDUE')),
  target_date TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'NTFY' CHECK (channel IN ('NTFY', 'SLACK')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  failed_at TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  CHECK ((status = 'SENT') = (sent_at IS NOT NULL)),
  UNIQUE (action_id, kind, target_date, channel)
);
CREATE INDEX ix_notification_deliveries_status ON notification_deliveries (status, created_at);
