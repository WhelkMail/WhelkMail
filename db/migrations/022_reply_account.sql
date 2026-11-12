-- Send replies to messages received on this account from another account.
--
-- Typical setup: a mailbox on a provider receives the mail of a domain that only
-- forwards (EMAIL@DOMAIN.IT -> EMAIL@PROVIDER.IT). Replies must leave from the
-- domain address, which the app knows as a send-only (relay) account. This
-- column points at that account; it is cleared when the account is deleted.
ALTER TABLE accounts ADD COLUMN reply_account_id TEXT;
