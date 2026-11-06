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
