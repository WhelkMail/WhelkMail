ALTER TABLE labels ADD COLUMN account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_labels_account ON labels (account_id);

CREATE TABLE IF NOT EXISTS filters (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  from_pattern TEXT,
  to_pattern TEXT,
  subject_pattern TEXT,
  has_words TEXT,
  doesnt_have TEXT,
  has_attachment INTEGER NOT NULL DEFAULT 0,
  label_ids_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_filters_account ON filters (account_id);
