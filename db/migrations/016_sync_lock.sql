CREATE TABLE IF NOT EXISTS imap_sync_locks (
  lock_key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_imap_sync_locks_expires ON imap_sync_locks (expires_at);
