CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email ON contacts (lower(email));
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name COLLATE NOCASE);
