CREATE TABLE IF NOT EXISTS imap_sync (
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  uid_validity INTEGER,
  max_uid INTEGER NOT NULL DEFAULT 0,
  min_uid INTEGER NOT NULL DEFAULT 0,
  backfill_done INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  error TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  synced INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, folder)
);

CREATE TABLE IF NOT EXISTS imap_messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  uid INTEGER NOT NULL,
  uid_validity INTEGER,
  stable_key TEXT NOT NULL,
  message_id TEXT,
  from_name TEXT,
  from_email TEXT NOT NULL,
  to_json TEXT NOT NULL,
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_imap_messages_uid ON imap_messages (account_id, folder, uid);
CREATE INDEX IF NOT EXISTS idx_imap_messages_list ON imap_messages (account_id, folder, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_imap_messages_stable ON imap_messages (account_id, stable_key);
