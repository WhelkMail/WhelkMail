import type {
  Account,
  AttachmentMeta,
  Folder,
  Mailbox,
  MailSecurity,
  MessageSummary,
  StorageDriver,
} from '../../shared/types'
import type { Env } from './env'

export interface AccountRow {
  id: string
  email: string
  display_name: string
  kind: string
  imap_host: string | null
  imap_port: number | null
  imap_security: string | null
  smtp_host: string | null
  smtp_port: number | null
  smtp_security: string | null
  username: string | null
  auth_type: string
  secret_enc: string | null
  access_token_enc: string | null
  access_token_expires_at: number | null
  oauth_provider: string | null
  sent_folder: string
  auto_saves_sent: number
  max_attachment_bytes: number
  storage_driver: string
  relay_provider: string | null
  relay_api_key_enc: string | null
  relay_api_secret_enc: string | null
  relay_domain: string | null
  relay_region: string | null
  drive_email: string | null
  drive_folder_id: string | null
  drive_refresh_token_enc: string | null
  drive_access_token_enc: string | null
  drive_token_expires_at: number | null
  signature: string | null
  incoming_label_id: string | null
  archive_imap_bodies: number
  imap_archive_driver: string
  delete_after_archive: number
  auto_sync: number
  created_at: string
}

export interface MessageRow {
  id: string
  account_id: string
  folder: string
  message_id: string | null
  from_name: string | null
  from_email: string
  to_json: string
  cc_json: string
  bcc_json: string
  subject: string
  snippet: string
  body_text: string
  body_html: string | null
  sent_at: string
  size: number
  storage_driver: string
  storage_key: string
  attachments_json: string
  status: string
  created_at: string
}

export async function getAccountRow(env: Env, id: string): Promise<AccountRow | null> {
  return env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>()
}

export async function listAccountRows(env: Env): Promise<AccountRow[]> {
  const result = await env.DB.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all<AccountRow>()
  return result.results
}

export function publicAccount(row: AccountRow, r2Available: boolean): Account {
  const isImap = row.kind === 'imap'
  const connected = isImap ? Boolean(row.secret_enc) : true
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    kind: isImap ? 'imap' : 'relay',
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapSecurity: (row.imap_security as MailSecurity | null) ?? null,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecurity: (row.smtp_security as MailSecurity | null) ?? null,
    username: row.username ?? row.email,
    authType: row.auth_type === 'oauth2' ? 'oauth2' : 'password',
    oauthProvider:
      row.oauth_provider === 'google' || row.oauth_provider === 'microsoft'
        ? row.oauth_provider
        : null,
    connected,
    signature: row.signature ?? '',
    incomingLabelId: row.incoming_label_id ?? null,
    archiveImapBodies: Boolean(row.archive_imap_bodies),
    imapArchiveDriver: row.imap_archive_driver === 'drive' ? 'drive' : 'r2',
    deleteAfterArchive: Boolean(row.delete_after_archive),
    autoSync: Boolean(row.auto_sync),
    sentFolder: row.sent_folder,
    autoSavesSent: Boolean(row.auto_saves_sent),
    maxAttachmentBytes: row.max_attachment_bytes,
    storageDriver: row.storage_driver as StorageDriver,
    relayProvider: row.relay_provider,
    relayConfigured: Boolean(row.relay_api_key_enc),
    driveConnected: Boolean(row.drive_refresh_token_enc),
    r2Available,
    createdAt: row.created_at,
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function relayMessageSummary(row: MessageRow, account: AccountRow): MessageSummary {
  const attachments = parseJson<AttachmentMeta[]>(row.attachments_json, [])
  return {
    id: `r_${row.id}`,
    accountId: row.account_id,
    accountEmail: account.email,
    accountName: account.display_name,
    folder: row.folder as Folder,
    from: { name: row.from_name, email: row.from_email },
    to: parseJson<Mailbox[]>(row.to_json, []),
    cc: parseJson<Mailbox[]>(row.cc_json, []),
    bcc: parseJson<Mailbox[]>(row.bcc_json, []),
    subject: row.subject,
    snippet: row.snippet,
    date: row.sent_at,
    unread: false,
    hasAttachments: attachments.length > 0,
    status: row.status === 'failed' ? 'failed' : row.status === 'draft' ? 'draft' : 'sent',
    labelIds: [],
  }
}

export function mailboxesFromAddresses(addresses: string[]): Mailbox[] {
  return addresses.map((address) => ({ name: null, email: address }))
}
