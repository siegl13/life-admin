-- Item-owned field groups. A group is a generic, ordered collection of
-- fields. Groups belong to the ITEM (not to a cycle) and fields are
-- assigned by field_key, so organization and feature state survive cycle
-- rollover without any copy step. A playbook may seed groups only when an
-- item is created; after that the item owns them.
--
-- Every item has exactly one default group (shown as the localized
-- "General" while its label is NULL). A field without an assignment row
-- belongs to it. Existing items get only that default group, so no
-- existing field moves and no bundled playbook definition is applied to
-- existing items.
CREATE TABLE item_field_groups (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  label      TEXT CHECK (label IS NULL OR length(trim(label)) > 0),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  featured   INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  position   INTEGER NOT NULL,
  CHECK (is_default = 1 OR label IS NOT NULL)
);

CREATE UNIQUE INDEX ux_item_field_groups_default
  ON item_field_groups (item_id) WHERE is_default = 1;
CREATE INDEX ix_item_field_groups_item_position ON item_field_groups (item_id, position);

CREATE TABLE item_field_group_assignments (
  item_id   TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  group_id  TEXT NOT NULL REFERENCES item_field_groups (id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, field_key)
);

CREATE INDEX ix_item_field_group_assignments_group ON item_field_group_assignments (group_id);

INSERT INTO item_field_groups (id, item_id, label, is_default, featured, position)
SELECT lower(hex(randomblob(16))), id, NULL, 1, 0, 0 FROM items;
