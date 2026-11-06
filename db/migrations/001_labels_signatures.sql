CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'blue',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS message_labels (
  message_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  label_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_message_labels_account ON message_labels (account_id, folder);
CREATE INDEX IF NOT EXISTS idx_message_labels_label ON message_labels (label_id);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE accounts ADD COLUMN signature TEXT;
