-- Remember which backend wrote each archived body.
--
-- An IMAP account can switch its archive between R2 and Google Drive, but the
-- objects already written stay where they were: reading and deleting them must
-- use the driver recorded on the row, not the account's current setting.
--
-- Rows archived before this column existed keep NULL: the reader tries the
-- configured backend first and then the other one.
ALTER TABLE imap_messages ADD COLUMN archive_driver TEXT;
