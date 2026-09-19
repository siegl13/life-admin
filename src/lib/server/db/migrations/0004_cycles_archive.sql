ALTER TABLE cycles ADD COLUMN playbook_version TEXT;
ALTER TABLE cycles ADD COLUMN completed_at TEXT;
ALTER TABLE items ADD COLUMN archived_at TEXT;
UPDATE cycles SET playbook_version=(SELECT playbook_version FROM items WHERE items.id=cycles.item_id) WHERE playbook_version IS NULL;
-- SQLite cannot add the ACTIVE/completed_at table CHECK without rebuilding cycles. Repository transactions enforce it.
CREATE INDEX ix_items_status_created ON items(status,created_at DESC);
