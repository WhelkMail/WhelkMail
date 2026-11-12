-- Trace of object-storage deletions that failed during an account purge.
--
-- The purge runs before the account row disappears, so a failure there cannot be
-- retried later: the Drive token goes away with the account. Keeping a small
-- persistent log is the only way to know which objects were left behind.
CREATE TABLE IF NOT EXISTS storage_cleanup_log (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  account_email TEXT NOT NULL,
  driver TEXT NOT NULL,
  object_key TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_storage_cleanup_created ON storage_cleanup_log (created_at DESC);
