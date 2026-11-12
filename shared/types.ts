export type AccountKind = 'imap' | 'relay'
/**
 * `provider` keeps mail on the mail server. Relay accounts choose `drive` or
 * `r2` for their sent copies/drafts, or `imap` to append them to the mailbox of
 * another (IMAP) account instead of an object archive.
 */
export type StorageDriver = 'provider' | 'drive' | 'r2' | 'imap'
export type AuthType = 'password' | 'oauth2'
export type MailSecurity = 'tls' | 'starttls'
export type ImapArchiveDriver = 'r2' | 'drive'
export type Folder = 'inbox' | 'sent' | 'draft' | 'spam'
export type MessageStatus = 'sent' | 'failed' | 'draft'
export type LabelColor = 'blue' | 'emerald' | 'amber' | 'violet' | 'rose' | 'cyan' | 'lime'

export interface Label {
  id: string
  name: string
  color: LabelColor
  createdAt: string
}

export interface Contact {
  id: string
  name: string
  email: string
  note: string
  createdAt: string
}

export interface ContactInput {
  name: string
  email: string
  note?: string
}

export type SyncStatus = 'idle' | 'partial' | 'done' | 'error'

export interface MailboxSyncState {
  folder: Folder
  uidValidity: number | null
  maxUid: number
  minUid: number
  backfillDone: boolean
  status: SyncStatus
  error: string | null
  total: number
  synced: number
  lastSyncedAt: string | null
}

export interface SyncResult {
  folders: MailboxSyncState[]
  hasMore: boolean
}

export interface AccountSyncOverview {
  accountId: string
  email: string
  syncing: boolean
  folders: MailboxSyncState[]
}

export interface SyncOverview {
  accounts: AccountSyncOverview[]
  syncing: boolean
}

export interface PushSubscriptionInput {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
  userAgent?: string
}

export interface PushPrefs {
  accountId: string
  email: string
  enabled: boolean
  folders: Folder[]
}

export interface DeletionLog {
  id: string
  accountId: string
  messageId: string
  status: string
  error: string | null
  createdAt: string
}

export interface MailFilter {
  id: string
  name: string
  from: string | null
  to: string | null
  subject: string | null
  hasWords: string | null
  doesntHave: string | null
  hasAttachment: boolean
  labelIds: string[]
  forwardTo: string[]
  enabled: boolean
  createdAt: string
  lastForwardStatus: string | null
  lastForwardError: string | null
  lastForwardAt: string | null
}

export interface FilterInput {
  name?: string
  from?: string | null
  to?: string | null
  subject?: string | null
  hasWords?: string | null
  doesntHave?: string | null
  hasAttachment?: boolean
  labelIds?: string[]
  forwardTo?: string[]
  enabled?: boolean
}

export type SignatureMode = 'shared' | 'per_account'

/** One conversation row in the message list (threads are per account). */
export interface MailThread {
  threadKey: string
  accountId: string
  accountEmail: string
  accountName: string
  folder: Folder
  /** Newest message of the conversation in this folder. */
  latest: MessageSummary
  /** Date used for ordering and for the cursor (same value as the SQL MAX). */
  lastAt: string
  total: number
  unread: number
  /** Distinct senders, oldest first: the list shows them Gmail-style. */
  participants: Mailbox[]
}

export interface ThreadListResult {
  threads: MailThread[]
  errors: { accountId: string; email: string; message: string }[]
  /** A background sync is running (state reported by the sync lock). */
  syncing?: boolean
  /** Accounts whose mirror is stale: the client asks for a sync after painting. */
  staleAccounts?: string[]
  nextCursor: string | null
}

export interface StorageCleanupEntry {
  id: string
  accountEmail: string
  driver: string
  key: string
  error: string
  createdAt: string
}

export interface RetentionSummary {
  days: number
  lastRunAt: string | null
  lastDeleted: number
  deletedTotal: number
  cutoff: string | null
}

export interface AppSettings {
  defaultSignature: string
  signatureMode: SignatureMode
  allowRemoteImages: boolean
  /** Delete mirrored IMAP metadata older than this many days. 0 keeps everything. */
  metadataRetentionDays: number
}

export interface Mailbox {
  name: string | null
  email: string
}

export interface AttachmentMeta {
  index: number
  filename: string
  contentType: string
  size: number
  contentId?: string | null
}

export interface Account {
  id: string
  email: string
  displayName: string
  kind: AccountKind
  imapHost: string | null
  imapPort: number | null
  imapSecurity: MailSecurity | null
  smtpHost: string | null
  smtpPort: number | null
  smtpSecurity: MailSecurity | null
  username: string
  authType: AuthType
  oauthProvider: 'google' | 'microsoft' | null
  connected: boolean
  signature: string
  incomingLabelId: string | null
  archiveImapBodies: boolean
  imapArchiveDriver: ImapArchiveDriver
  deleteAfterArchive: boolean
  autoSync: boolean
  sentFolder: string
  autoSavesSent: boolean
  /** IMAP account that receives a copy of the sent mail (relay accounts only). */
  sentCopyAccountId: string | null
  /** Account used as the sender when replying to messages received here. */
  replyAccountId: string | null
  maxAttachmentBytes: number
  storageDriver: StorageDriver
  relayProvider: string | null
  relayConfigured: boolean
  driveConnected: boolean
  r2Available: boolean
  createdAt: string
}

export interface MessageSummary {
  id: string
  accountId: string
  accountEmail: string
  accountName: string
  folder: Folder
  from: Mailbox
  to: Mailbox[]
  cc: Mailbox[]
  bcc: Mailbox[]
  subject: string
  snippet: string
  date: string
  unread: boolean
  hasAttachments: boolean
  status: MessageStatus
  labelIds: string[]
  /** Conversation this message belongs to (per account). */
  threadKey?: string | null
  /** Messages in the conversation, filled by the grouped list. */
  threadCount?: number
  /** Unread messages in the conversation, filled by the grouped list. */
  threadUnread?: number
  /** Senders of the conversation, oldest first. */
  threadParticipants?: Mailbox[]
}

export interface MessageDetail extends MessageSummary {
  /** Addresses from Delivered-To/X-Original-To/Received that reveal a forwarding alias. */
  aliasAddresses: string[]
  /** RFC 5322 Message-ID, used as In-Reply-To when answering. */
  messageId: string | null
  /** Reference chain of this message, extended when answering. */
  references: string | null
  text: string
  html: string | null
  attachments: AttachmentMeta[]
  size: number
}

export interface StorageOptions {
  drive: boolean
  r2: boolean
}

export type SearchScope = 'all' | 'inbox' | 'sent' | 'draft' | 'spam'

export interface MessageSearchResult {
  messages: MessageSummary[]
  contacts: Contact[]
  errors: { accountId: string; email: string; message: string }[]
  nextCursor: string | null
}

export interface MessageListResult {
  messages: MessageSummary[]
  errors: { accountId: string; email: string; message: string }[]
  syncing?: boolean
  nextCursor: string | null
}

export interface AttachmentInput {
  filename: string
  contentType: string
  dataBase64: string
}

export interface SendPayload {
  accountId: string
  /** Message-ID answered by this compose, so the copy threads too. */
  inReplyTo?: string | null
  references?: string | null

  draftId?: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  text: string
  html?: string
  attachments: AttachmentInput[]
}

export interface ComposeSeed {
  accountId: string
  /** Message-ID answered by this compose, so the copy threads too. */
  inReplyTo?: string | null
  references?: string | null

  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
}

export interface DraftPayload {
  id: string
  accountId: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html: string | null
  attachments: AttachmentInput[]
}

export interface DraftSavePayload {
  accountId: string
  /** Message-ID answered by this compose, so the copy threads too. */
  inReplyTo?: string | null
  references?: string | null

  draftId?: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html?: string
  attachments: AttachmentInput[]
}

export interface HealthStatus {
  ok: boolean
  driveConfigured: boolean
  r2Configured: boolean
  relayConfigured: boolean
  relayProvider: string
  relayLabel: string
  maxAttachmentBytes: number
  microsoftConfigured: boolean
  googleMailConfigured: boolean
  pushConfigured: boolean
  cronConfigured: boolean
}

export interface AccountCreateInput {
  kind: AccountKind
  email: string
  displayName: string
  preset?: string
  imapHost?: string
  imapPort?: number
  imapSecurity?: MailSecurity
  smtpHost?: string
  smtpPort?: number
  smtpSecurity?: MailSecurity
  username?: string
  authType?: AuthType
  oauthProvider?: 'google' | 'microsoft'
  password?: string
  autoSavesSent?: boolean
  storageDriver?: StorageDriver
  sentCopyAccountId?: string
  relayProvider?: string
  relayApiKey?: string
  relayApiSecret?: string
  relayDomain?: string
  relayRegion?: string
  incomingLabelName?: string
}

export interface LabelInput {
  name: string
  color?: LabelColor
}

export interface AccountPatch {
  displayName?: string
  signature?: string
  incomingLabelId?: string | null
  archiveImapBodies?: boolean
  imapArchiveDriver?: ImapArchiveDriver
  deleteAfterArchive?: boolean
  autoSync?: boolean
  sentFolder?: string
  autoSavesSent?: boolean
  sentCopyAccountId?: string | null
  replyAccountId?: string | null
  storageDriver?: StorageDriver
  password?: string
  username?: string
  imapHost?: string
  imapPort?: number
  imapSecurity?: MailSecurity
  smtpHost?: string
  smtpPort?: number
  smtpSecurity?: MailSecurity
  relayProvider?: string
  relayApiKey?: string
  relayApiSecret?: string
  relayDomain?: string
  relayRegion?: string
}

export interface LoginResult {
  ok: boolean
  twoFactorRequired?: boolean
  challenge?: string
}

export interface TwoFactorStatus {
  enabled: boolean
  recoveryRemaining: number
}

export interface TotpSetup {
  secret: string
  otpauth: string
}

export interface TotpEnableResult {
  recoveryCodes: string[]
}
