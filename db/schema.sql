CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'imap',
  imap_host TEXT,
  imap_port INTEGER,
  imap_security TEXT,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_security TEXT,
  username TEXT,
  auth_type TEXT NOT NULL DEFAULT 'password',
  secret_enc TEXT,
  access_token_enc TEXT,
  access_token_expires_at INTEGER,
  oauth_provider TEXT,
  sent_folder TEXT NOT NULL DEFAULT 'Sent',
  drafts_folder TEXT,
  spam_folder TEXT,
  auto_saves_sent INTEGER NOT NULL DEFAULT 0,
  max_attachment_bytes INTEGER NOT NULL DEFAULT 15728640,
  storage_driver TEXT NOT NULL DEFAULT 'provider',
  relay_provider TEXT,
  relay_api_key_enc TEXT,
  relay_api_secret_enc TEXT,
  relay_domain TEXT,
  relay_region TEXT,
  drive_email TEXT,
  drive_folder_id TEXT,
  drive_refresh_token_enc TEXT,
  drive_access_token_enc TEXT,
  drive_token_expires_at INTEGER,
  signature TEXT,
  incoming_label_id TEXT,
  archive_imap_bodies INTEGER NOT NULL DEFAULT 0,
  imap_archive_driver TEXT NOT NULL DEFAULT 'r2',
  delete_after_archive INTEGER NOT NULL DEFAULT 0,
  auto_sync INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT 'sent',
  message_id TEXT,
  from_name TEXT,
  from_email TEXT NOT NULL,
  to_json TEXT NOT NULL,
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  sent_at TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  storage_driver TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_account_folder ON messages (account_id, folder, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_incoming_label ON accounts (incoming_label_id);

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'blue',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_labels_account ON labels (account_id);

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

CREATE TABLE IF NOT EXISTS filters (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  from_pattern TEXT,
  to_pattern TEXT,
  subject_pattern TEXT,
  has_words TEXT,
  doesnt_have TEXT,
  has_attachment INTEGER NOT NULL DEFAULT 0,
  label_ids_json TEXT NOT NULL DEFAULT '[]',
  forward_to_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_filters_account ON filters (account_id);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email ON contacts (lower(email));
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name COLLATE NOCASE);

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
  search_text TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  archive_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_imap_messages_uid ON imap_messages (account_id, folder, uid);
CREATE INDEX IF NOT EXISTS idx_imap_messages_list ON imap_messages (account_id, folder, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_imap_messages_page ON imap_messages (account_id, folder, sent_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_imap_messages_stable ON imap_messages (account_id, stable_key);

CREATE TABLE IF NOT EXISTS imap_body_cache (
  message_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  uid INTEGER NOT NULL,
  body BLOB NOT NULL,
  size INTEGER NOT NULL,
  cached_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_imap_body_cache_cached ON imap_body_cache (cached_at);

CREATE TABLE IF NOT EXISTS imap_sync_locks (
  lock_key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  owner TEXT
);

CREATE INDEX IF NOT EXISTS idx_imap_sync_locks_expires ON imap_sync_locks (expires_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_prefs (
  account_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  folders_json TEXT NOT NULL DEFAULT '["inbox"]',
  updated_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  blocked_until INTEGER
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  account_id TEXT NOT NULL,
  code_verifier TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states (expires_at);
