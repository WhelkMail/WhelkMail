-- Searchable plain text for IMAP messages.
--
-- `snippet` is only 160 characters and the sync used to store it empty, so a
-- search on an IMAP account could only match headers. This column keeps a
-- short extract of the body (at most 4000 characters) that is filled whenever a
-- body is parsed: message opened, archived, or snippet backfill.
ALTER TABLE imap_messages ADD COLUMN search_text TEXT NOT NULL DEFAULT '';

-- Pagination cursor: keyset scans use (sent_at, id) instead of OFFSET.
CREATE INDEX IF NOT EXISTS idx_imap_messages_page ON imap_messages (account_id, folder, sent_at DESC, id);
