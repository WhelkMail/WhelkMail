CREATE TABLE IF NOT EXISTS forward_rules (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  recipients_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_forward_rules_account ON forward_rules (account_id);

CREATE TABLE IF NOT EXISTS forward_log (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forward_log_unique ON forward_log (rule_id, message_id);
CREATE INDEX IF NOT EXISTS idx_forward_log_rule ON forward_log (rule_id, created_at DESC);

ALTER TABLE accounts ADD COLUMN delete_after_archive INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS deletion_log (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deletion_log_unique ON deletion_log (message_id);
CREATE INDEX IF NOT EXISTS idx_deletion_log_account ON deletion_log (account_id, created_at DESC);
