-- Send-only (relay) accounts can append a copy of every sent message to the
-- Sent folder of an IMAP account, on top of the Drive/R2 archive.
--
-- The column holds the id of the target IMAP account; it is cleared when that
-- account is deleted, and it is ignored for accounts of kind 'imap'.
ALTER TABLE accounts ADD COLUMN sent_copy_account_id TEXT;
