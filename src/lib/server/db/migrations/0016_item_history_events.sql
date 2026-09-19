CREATE TABLE item_history_events (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('OWNER', 'SYSTEM')),
  event_type  TEXT NOT NULL CHECK (event_type IN (
    'FIELD_CHANGED',
    'ATTACHMENT_ADDED',
    'ATTACHMENT_REMOVED',
    'ACTION_COMPLETED',
    'ACTION_SKIPPED',
    'ACTION_ADDED',
    'ACTION_DUE_OVERRIDE_SET',
    'ACTION_DUE_OVERRIDE_CLEARED',
    'CYCLE_STARTED',
    'CYCLE_COMPLETED',
    'ITEM_ARCHIVED',
    'ITEM_UNARCHIVED',
    'RELATION_LINKED',
    'RELATION_UNLINKED',
    'AI_SUGGESTIONS_ACCEPTED',
    'CUSTOM_FIELD_ADDED',
    'CUSTOM_FIELD_REMOVED'
  )),
  payload     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);

CREATE INDEX ix_item_history_events_item_created ON item_history_events (item_id, created_at DESC);
