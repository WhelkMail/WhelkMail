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
