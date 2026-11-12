-- Conversation grouping.
--
-- `thread_key` is the Message-ID of the root message of the conversation
-- (lowercase, without angle brackets). A message that is not a reply is its own
-- root, so nothing has to be rewritten when a reply arrives later: the reply just
-- adopts the key of its parent.
--
-- Threads are per account: the same subject on two mailboxes stays two
-- conversations, like Gmail's per-account threading.
ALTER TABLE imap_messages ADD COLUMN thread_key TEXT;
ALTER TABLE messages ADD COLUMN thread_key TEXT;

CREATE INDEX IF NOT EXISTS idx_imap_messages_thread ON imap_messages (account_id, thread_key, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (account_id, thread_key, sent_at DESC);
