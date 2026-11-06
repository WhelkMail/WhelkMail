UPDATE labels SET account_id = NULL;
UPDATE filters SET account_id = '';

ALTER TABLE accounts ADD COLUMN incoming_label_id TEXT;
CREATE INDEX IF NOT EXISTS idx_accounts_incoming_label ON accounts (incoming_label_id);
