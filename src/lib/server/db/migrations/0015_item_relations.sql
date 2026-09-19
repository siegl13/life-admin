CREATE TABLE item_relations (
  item_a_id TEXT NOT NULL REFERENCES items (id) ON DELETE RESTRICT,
  item_b_id TEXT NOT NULL REFERENCES items (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_a_id, item_b_id),
  CHECK (item_a_id < item_b_id)
);

CREATE INDEX ix_item_relations_item_a ON item_relations (item_a_id);
CREATE INDEX ix_item_relations_item_b ON item_relations (item_b_id);
