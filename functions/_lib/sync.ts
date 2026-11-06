import type {
  Folder,
  Mailbox,
  MailboxSyncState,
  MessageSummary,
  SyncStatus,
} from '../../shared/types'
import type { AccountRow } from './db'
import type { Env } from './env'
import type { ImapHeader } from './imap/client'
import { withImap, resolveFolderName } from './mail/imap'
import { getImapArchiveStorage, type StorageAdapter } from './storage'
import { imapMessageId } from './mail/ids'
import { dateOf, parseHeaders, toMailbox, toMailboxes } from './mail/parse'

export const SYNC_FOLDERS: Folder[] = ['inbox', 'sent', 'draft']
const CHUNK_SIZE = 40

export interface SyncRow {
  account_id: string
  folder: string
  uid_validity: number | null
  max_uid: number
  min_uid: number
  backfill_done: number
  status: string
  error: string | null
  total: number
  synced: number
  last_synced_at: string | null
  updated_at: string
}

export interface ImapMessageRow {
  id: string
  account_id: string
  folder: string
  uid: number
  uid_validity: number | null
  stable_key: string
  message_id: string | null
  from_name: string | null
  from_email: string
  to_json: string
  cc_json: string
  bcc_json: string
  subject: string
  snippet: string
  sent_at: string
  size: number
  unread: number
  has_attachments: number
  archived: number
  archive_key: string | null
  created_at: string
  updated_at: string
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function syncStatus(value: string): SyncStatus {
  return value === 'partial' || value === 'done' || value === 'error' ? value : 'idle'
}

export function toSyncState(row: SyncRow): MailboxSyncState {
  return {
    folder: row.folder as Folder,
    uidValidity: row.uid_validity,
    maxUid: row.max_uid,
    minUid: row.min_uid,
    backfillDone: Boolean(row.backfill_done),
    status: syncStatus(row.status),
    error: row.error,
    total: row.total,
    synced: row.synced,
    lastSyncedAt: row.last_synced_at,
  }
}

function emptyState(folder: Folder): MailboxSyncState {
  return {
    folder,
    uidValidity: null,
    maxUid: 0,
    minUid: 0,
    backfillDone: false,
    status: 'idle',
    error: null,
    total: 0,
    synced: 0,
    lastSyncedAt: null,
  }
}

export async function getSyncStates(env: Env, accountId: string): Promise<MailboxSyncState[]> {
  const rows = await env.DB.prepare('SELECT * FROM imap_sync WHERE account_id = ?')
    .bind(accountId)
    .all<SyncRow>()
  const byFolder = new Map(rows.results.map((row) => [row.folder, toSyncState(row)]))
  return SYNC_FOLDERS.map((folder) => byFolder.get(folder) ?? emptyState(folder))
}

export function imapMessageSummary(row: ImapMessageRow, account: AccountRow): MessageSummary {
  return {
    id: row.id,
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
    unread: Boolean(row.unread),
    hasAttachments: Boolean(row.has_attachments),
    status: row.folder === 'draft' ? 'draft' : 'sent',
    labelIds: [],
  }
}

export async function listMirrorMessages(
  env: Env,
  account: AccountRow,
  folder: Folder,
  limit = 100,
): Promise<MessageSummary[]> {
  const rows = await env.DB.prepare(
    'SELECT * FROM imap_messages WHERE account_id = ? AND folder = ? ORDER BY sent_at DESC LIMIT ?',
  )
    .bind(account.id, folder, limit)
    .all<ImapMessageRow>()
  return rows.results.map((row) => imapMessageSummary(row, account))
}

function stableKey(accountId: string, email: Awaited<ReturnType<typeof parseHeaders>>): string {
  const messageId = email.messageId?.trim()
  if (messageId) {
    return `mid:${messageId.toLowerCase()}`
  }
  const basis = [
    accountId,
    email.from?.address?.toLowerCase() ?? '',
    (email.to ?? []).map((item) => item.address?.toLowerCase() ?? '').join(','),
    email.subject ?? '',
    email.date ?? '',
  ].join('|')
  let hash = 2166136261
  for (let index = 0; index < basis.length; index += 1) {
    hash ^= basis.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `h:${(hash >>> 0).toString(36)}`
}

async function countMessages(env: Env, accountId: string, folder: Folder): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM imap_messages WHERE account_id = ? AND folder = ?',
  )
    .bind(accountId, folder)
    .first<{ count: number }>()
  return row?.count ?? 0
}

async function upsertSyncState(
  env: Env,
  accountId: string,
  folder: Folder,
  values: {
    uidValidity: number | null
    maxUid: number
    minUid: number
    backfillDone: boolean
    status: SyncStatus
    error: string | null
    total: number
    synced: number
    lastSyncedAt: string | null
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO imap_sync (account_id, folder, uid_validity, max_uid, min_uid, backfill_done, status, error, total, synced, last_synced_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, folder) DO UPDATE SET uid_validity = excluded.uid_validity, max_uid = excluded.max_uid, min_uid = excluded.min_uid, backfill_done = excluded.backfill_done, status = excluded.status, error = excluded.error, total = excluded.total, synced = excluded.synced, last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at`,
  )
    .bind(
      accountId,
      folder,
      values.uidValidity,
      values.maxUid,
      values.minUid,
      values.backfillDone ? 1 : 0,
      values.status,
      values.error,
      values.total,
      values.synced,
      values.lastSyncedAt,
      new Date().toISOString(),
    )
    .run()
}

export async function markSyncError(
  env: Env,
  accountId: string,
  folder: Folder,
  error: string,
): Promise<void> {
  const row = await env.DB.prepare(
    'SELECT * FROM imap_sync WHERE account_id = ? AND folder = ?',
  )
    .bind(accountId, folder)
    .first<SyncRow>()
  await upsertSyncState(env, accountId, folder, {
    uidValidity: row?.uid_validity ?? null,
    maxUid: row?.max_uid ?? 0,
    minUid: row?.min_uid ?? 0,
    backfillDone: Boolean(row?.backfill_done),
    status: 'error',
    error,
    total: row?.total ?? 0,
    synced: await countMessages(env, accountId, folder),
    lastSyncedAt: row?.last_synced_at ?? null,
  })
}

async function transferLabels(
  env: Env,
  accountId: string,
  headers: { id: string; stableKey: string; folder: Folder }[],
): Promise<void> {
  if (headers.length === 0) {
    return
  }
  const keys = [...new Set(headers.map((header) => header.stableKey))]
  if (keys.length === 0) {
    return
  }
  const ids = headers.map((header) => header.id)
  const keyPlaceholders = keys.map(() => '?').join(', ')
  const idPlaceholders = ids.map(() => '?').join(', ')
  const stale = await env.DB.prepare(
    `SELECT id, stable_key FROM imap_messages WHERE account_id = ? AND stable_key IN (${keyPlaceholders}) AND id NOT IN (${idPlaceholders})`,
  )
    .bind(accountId, ...keys, ...ids)
    .all<{ id: string; stable_key: string }>()
  if (stale.results.length === 0) {
    return
  }
  const byKey = new Map(headers.map((header) => [header.stableKey, header]))
  const oldIds = stale.results.map((row) => row.id)
  const oldPlaceholders = oldIds.map(() => '?').join(', ')
  const labels = await env.DB.prepare(
    `SELECT message_id, label_id FROM message_labels WHERE message_id IN (${oldPlaceholders})`,
  )
    .bind(...oldIds)
    .all<{ message_id: string; label_id: string }>()
  const createdAt = new Date().toISOString()
  const statements: D1PreparedStatement[] = []
  for (const row of stale.results) {
    const target = byKey.get(row.stable_key)
    if (!target) {
      continue
    }
    for (const label of labels.results.filter((item) => item.message_id === row.id)) {
      statements.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO message_labels (message_id, account_id, folder, label_id, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(target.id, accountId, target.folder, label.label_id, createdAt),
      )
    }
  }
  for (const oldId of oldIds) {
    statements.push(
      env.DB.prepare('DELETE FROM message_labels WHERE message_id = ?').bind(oldId),
    )
  }
  if (statements.length > 0) {
    await env.DB.batch(statements)
  }
}

async function pruneFolder(
  env: Env,
  accountId: string,
  folder: Folder,
  allUids: number[],
  storage: StorageAdapter | null,
  keepArchive: boolean,
): Promise<void> {
  const rows = await env.DB.prepare(
    'SELECT id, uid, archive_key FROM imap_messages WHERE account_id = ? AND folder = ?',
  )
    .bind(accountId, folder)
    .all<{ id: string; uid: number; archive_key: string | null }>()
  const present = new Set(allUids)
  const stale = rows.results.filter((row) => !present.has(row.uid))
  if (stale.length === 0) {
    return
  }
  if (storage && !keepArchive) {
    for (const row of stale) {
      if (row.archive_key) {
        try {
          await storage.remove(row.archive_key)
        } catch {
          // best effort
        }
      }
    }
  }
  const statements: D1PreparedStatement[] = []
  for (const row of stale) {
    statements.push(
      env.DB.prepare('DELETE FROM message_labels WHERE message_id = ?').bind(row.id),
      env.DB.prepare('DELETE FROM imap_messages WHERE id = ?').bind(row.id),
    )
  }
  await env.DB.batch(statements)
}

export async function runSyncChunk(
  env: Env,
  account: AccountRow,
  folder: Folder,
): Promise<{ folders: MailboxSyncState[]; hasMore: boolean }> {
  const row = await env.DB.prepare(
    'SELECT * FROM imap_sync WHERE account_id = ? AND folder = ?',
  )
    .bind(account.id, folder)
    .first<SyncRow>()

  let uidValidity = row?.uid_validity ?? null
  let maxUid = row?.max_uid ?? 0
  let minUid = row?.min_uid ?? 0
  let backfillDone = Boolean(row?.backfill_done)
  const archiveStorage = getImapArchiveStorage(env, account)
  const archiveBodies = Boolean(archiveStorage)
  const chunkSize = archiveBodies ? 8 : CHUNK_SIZE
  let archiveMore = false

  await withImap(env, account, async (connection) => {
    const target = await resolveFolderName(connection, account, folder)
    const details = await connection.selectWithDetails(target)
    uidValidity = details.uidValidity
    const allUids = (await connection.searchAll()).sort((left, right) => left - right)

    if (row?.uid_validity && details.uidValidity && row.uid_validity !== details.uidValidity) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM message_labels WHERE account_id = ? AND folder = ?').bind(
          account.id,
          folder,
        ),
        env.DB.prepare('DELETE FROM imap_messages WHERE account_id = ? AND folder = ?').bind(
          account.id,
          folder,
        ),
      ])
      maxUid = 0
      minUid = 0
      backfillDone = false
    }

    const newUids = maxUid === 0 ? allUids : allUids.filter((uid) => uid > maxUid)
    let uidsToFetch: number[] = []
    let phase: 'new' | 'backfill' | 'idle' = 'idle'
    if (newUids.length > 0) {
      uidsToFetch = maxUid === 0 ? newUids.slice(-chunkSize) : newUids.slice(0, chunkSize)
      phase = 'new'
    } else if (!backfillDone) {
      const older = allUids.filter((uid) => minUid === 0 || uid < minUid)
      if (older.length > 0) {
        uidsToFetch = older.slice(-chunkSize)
        phase = 'backfill'
      } else {
        backfillDone = true
      }
    }

    if (uidsToFetch.length > 0) {
      const headers = await connection.fetchHeaders(uidsToFetch)
      const now = new Date().toISOString()
      const parsed: {
        header: ImapHeader
        row: ImapMessageRow
        id: string
        stableKey: string
        folder: Folder
      }[] = []
      for (const header of headers) {
        const email = await parseHeaders(header.header)
        const from = toMailbox(email.from)
        const id = imapMessageId(account.id, folder, header.uid)
        const key = stableKey(account.id, email)
        parsed.push({
          header,
          id,
          stableKey: key,
          folder,
          row: {
            id,
            account_id: account.id,
            folder,
            uid: header.uid,
            uid_validity: details.uidValidity,
            stable_key: key,
            message_id: email.messageId ?? null,
            from_name: from.name,
            from_email: from.email,
            to_json: JSON.stringify(toMailboxes(email.to)),
            cc_json: JSON.stringify(toMailboxes(email.cc)),
            bcc_json: JSON.stringify(toMailboxes(email.bcc)),
            subject: email.subject ?? '',
            snippet: '',
            sent_at: dateOf(email),
            size: header.size,
            unread:
              folder === 'draft'
                ? 0
                : header.flags.some((flag) => flag.toLowerCase() === '\\seen')
                  ? 0
                  : 1,
            has_attachments: header.hasAttachments ? 1 : 0,
            archived: 0,
            archive_key: null,
            created_at: now,
            updated_at: now,
          },
        })
      }

      if (parsed.length > 0) {
        await env.DB.batch(
          parsed.map((item) =>
            env.DB.prepare(
              `INSERT INTO imap_messages (id, account_id, folder, uid, uid_validity, stable_key, message_id, from_name, from_email, to_json, cc_json, bcc_json, subject, snippet, sent_at, size, unread, has_attachments, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET uid_validity = excluded.uid_validity, stable_key = excluded.stable_key, message_id = excluded.message_id, from_name = excluded.from_name, from_email = excluded.from_email, to_json = excluded.to_json, cc_json = excluded.cc_json, bcc_json = excluded.bcc_json, subject = excluded.subject, snippet = excluded.snippet, sent_at = excluded.sent_at, size = excluded.size, unread = excluded.unread, has_attachments = excluded.has_attachments, updated_at = excluded.updated_at`,
            ).bind(
              item.row.id,
              item.row.account_id,
              item.row.folder,
              item.row.uid,
              item.row.uid_validity,
              item.row.stable_key,
              item.row.message_id,
              item.row.from_name,
              item.row.from_email,
              item.row.to_json,
              item.row.cc_json,
              item.row.bcc_json,
              item.row.subject,
              item.row.snippet,
              item.row.sent_at,
              item.row.size,
              item.row.unread,
              item.row.has_attachments,
              item.row.created_at,
              item.row.updated_at,
            ),
          ),
        )
        await transferLabels(
          env,
          account.id,
          parsed.map((item) => ({ id: item.id, stableKey: item.stableKey, folder })),
        )
      }

      if (archiveStorage && parsed.length > 0) {
        const updates: D1PreparedStatement[] = []
        for (const item of parsed) {
          try {
            const bytes = await connection.fetchFull(item.header.uid)
            const key = `imap/${account.id}/${folder}/${details.uidValidity ?? 0}/${folder}-${item.header.uid}.eml`
            const stored = await archiveStorage.put(key, bytes, 'message/rfc822')
            updates.push(
              env.DB.prepare('UPDATE imap_messages SET archived = 1, archive_key = ? WHERE id = ?').bind(
                stored.key,
                item.id,
              ),
            )
          } catch {
            // Keep the message on the provider if the archive write fails.
          }
        }
        if (updates.length > 0) {
          await env.DB.batch(updates)
        }
      }

      const fetchedMin = Math.min(...uidsToFetch)
      const fetchedMax = Math.max(...uidsToFetch)
      if (phase === 'new') {
        maxUid = maxUid === 0 ? fetchedMax : Math.max(maxUid, fetchedMax)
        minUid = minUid === 0 ? fetchedMin : Math.min(minUid, fetchedMin)
      } else {
        minUid = minUid === 0 ? fetchedMin : Math.min(minUid, fetchedMin)
      }
    }

    if (archiveStorage) {
      const pending = await env.DB.prepare(
        'SELECT id, uid FROM imap_messages WHERE account_id = ? AND folder = ? AND archived = 0 ORDER BY uid ASC LIMIT ?',
      )
        .bind(account.id, folder, chunkSize)
        .all<{ id: string; uid: number }>()
      const updates: D1PreparedStatement[] = []
      for (const item of pending.results) {
        try {
          const bytes = await connection.fetchFull(item.uid)
          const key = `imap/${account.id}/${folder}/${details.uidValidity ?? 0}/${folder}-${item.uid}.eml`
          const stored = await archiveStorage.put(key, bytes, 'message/rfc822')
          updates.push(
            env.DB.prepare('UPDATE imap_messages SET archived = 1, archive_key = ? WHERE id = ?').bind(
              stored.key,
              item.id,
            ),
          )
        } catch {
          // Retry on the next sync.
        }
      }
      if (updates.length > 0) {
        await env.DB.batch(updates)
      }
      const remaining = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM imap_messages WHERE account_id = ? AND folder = ? AND archived = 0',
      )
        .bind(account.id, folder)
        .first<{ count: number }>()
      archiveMore = (remaining?.count ?? 0) > 0
    }

    if (!backfillDone && !allUids.some((uid) => uid < minUid)) {
      backfillDone = true
    }
    const hasMore =
      allUids.some((uid) => uid > maxUid) ||
      (!backfillDone && allUids.some((uid) => uid < minUid)) ||
      archiveMore

    if (!hasMore) {
      await pruneFolder(
        env,
        account.id,
        folder,
        allUids,
        archiveStorage,
        Boolean(account.delete_after_archive),
      )
    }

    const synced = await countMessages(env, account.id, folder)
    await upsertSyncState(env, account.id, folder, {
      uidValidity,
      maxUid,
      minUid,
      backfillDone,
      status: hasMore ? 'partial' : 'done',
      error: null,
      total: allUids.length,
      synced,
      lastSyncedAt: new Date().toISOString(),
    })
  })

  const folders = await getSyncStates(env, account.id)
  const current = folders.find((item) => item.folder === folder)
  return {
    folders,
    hasMore: current ? current.status === 'partial' : false,
  }
}
