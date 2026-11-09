INSERT OR IGNORE INTO message_labels (message_id, account_id, folder, label_id, created_at)
SELECT m.id, m.account_id, m.folder, a.incoming_label_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM imap_messages m
JOIN accounts a ON a.id = m.account_id
WHERE a.incoming_label_id IS NOT NULL;

INSERT OR IGNORE INTO message_labels (message_id, account_id, folder, label_id, created_at)
SELECT m.id, m.account_id, m.folder, a.incoming_label_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM messages m
JOIN accounts a ON a.id = m.account_id
WHERE a.incoming_label_id IS NOT NULL;
