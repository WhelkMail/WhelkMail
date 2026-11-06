ALTER TABLE filters ADD COLUMN forward_to_json TEXT NOT NULL DEFAULT '[]';

DROP TABLE IF EXISTS forward_log;
DROP TABLE IF EXISTS forward_rules;

CREATE TABLE IF NOT EXISTS forward_log (
  id TEXT PRIMARY KEY,
  filter_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forward_log_unique ON forward_log (filter_id, message_id);
CREATE INDEX IF NOT EXISTS idx_forward_log_filter ON forward_log (filter_id, created_at DESC);
