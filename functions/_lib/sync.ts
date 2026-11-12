import type {
  Folder,
  Mailbox,
  MailboxSyncState,
  MessageSummary,
  SyncStatus,
} from '../../shared/types'
import { idExclusionClause, type AccountRow } from './db'
import type { Env } from './env'
import type { PageCursor } from '../../shared/paging'
import type { ImapConnection, ImapHeader } from './imap/client'
import { MISSING_FOLDER, withImap, resolveFolderName } from './mail/imap'
import { applyAccountLabel, applyFilters } from './filters'
import { archiveUpdateStatement } from './mail/archive-update'
import {
  isReplySubject,
  normalizeMessageId,
  normalizeSubject,
  referenceIds,
  threadKeyFor,
} from './mail/thread-key'
import { archiveStorageCandidates, getImapArchiveStorage } from './storage'
import { imapMessageId } from './mail/ids'
import { bodyText, dateOf, parseFull, parseHeaders, toMailbox, toMailboxes } from './mail/parse'
import { indexMessageText } from './mail/search-text'
import { isSchemaError } from './schema'
import {
  advanceSyncWindow,
  isBackfillComplete,
  MAX_INDEXED_BODY_BYTES,
  shouldResetOnUidValidity,
  shouldResumeBackfill,
  SNIPPET_BATCH,
} from './sync-plan'

export const SYNC_FOLDERS: Folder[] = ['inbox', 'sent', 'draft', 'spam']
const CHUNK_SIZE = 40
const BACKFILL_WINDOW = 400
const FLAG_WINDOW = 120

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
  thread_key: string | null
  from_name: string | null
  from_email: string
  to_json: string
  cc_json: string
  bcc_json: string
  subject: string
  snippet: string
  search_text: string
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

export async function getSyncState(
  env: Env,
  accountId: string,
  folder: Folder,
): Promise<MailboxSyncState | null> {
  const row = await env.DB.prepare(
    'SELECT * FROM imap_sync WHERE account_id = ? AND folder = ?',
  )
    .bind(accountId, folder)
    .first<SyncRow>()
  return row ? toSyncState(row) : null
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
    threadKey: row.thread_key ?? null,
  }
}

export async function listMirrorMessages(
  env: Env,
  account: AccountRow,
  folder: Folder,
  limit = 100,
  before?: PageCursor | null,
  excludeIds: string[] = [],
): Promise<MessageSummary[]> {
  // Exclusions must run inside SQL: filtering after LIMIT would shrink the page
  // and, because the next cursor is only returned for a full page, hide older
  // messages. Drafts a relay account keeps in another mailbox are the use case.
  const exclusion = idExclusionClause('id', excludeIds)
  const rows = before
    ? await env.DB.prepare(
        `SELECT * FROM imap_messages
         WHERE account_id = ? AND folder = ?${exclusion}
           AND (sent_at < ? OR (sent_at = ? AND id < ?))
         ORDER BY sent_at DESC, id DESC LIMIT ?`,
      )
        .bind(account.id, folder, before.date, before.date, before.id, limit)
        .all<ImapMessageRow>()
    : await env.DB.prepare(
        `SELECT * FROM imap_messages WHERE account_id = ? AND folder = ?${exclusion} ORDER BY sent_at DESC, id DESC LIMIT ?`,
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

export async function invalidateSync(
  env: Env,
  accountId: string,
  folder: Folder,
): Promise<void> {
  await env.DB.prepare(
    'UPDATE imap_sync SET last_synced_at = NULL WHERE account_id = ? AND folder = ?',
  )
    .bind(accountId, folder)
    .run()
}

export async function queueSync(
  env: Env,
  account: AccountRow,
  folder: Folder,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<void> {
  await invalidateSync(env, account.id, folder).catch(() => undefined)
  waitUntil(
    runSyncChunk(env, account, folder).catch(async (error) => {
      await markSyncError(
        env,
        account.id,
        folder,
        error instanceof Error ? error.message : String(error),
      ).catch(() => undefined)
    }),
  )
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
  account: AccountRow,
  keepArchive: boolean,
): Promise<void> {
  const rows = await env.DB.prepare(
    'SELECT id, uid, archive_key, archive_driver FROM imap_messages WHERE account_id = ? AND folder = ?',
  )
    .bind(accountId, folder)
    .all<{ id: string; uid: number; archive_key: string | null; archive_driver: string | null }>()
  const present = new Set(allUids)
  const stale = rows.results.filter((row) => !present.has(row.uid))
  if (stale.length === 0) {
    return
  }
  if (!keepArchive) {
    for (const row of stale) {
      if (!row.archive_key) {
        continue
      }
      // The object may have been written by the other backend: try the recorded
      // driver first, then the remaining one.
      for (const storage of archiveStorageCandidates(env, account, row.archive_driver)) {
        try {
          await storage.remove(row.archive_key)
          break
        } catch {
          // best effort, try the next backend
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

async function newUidsSince(
  connection: ImapConnection,
  startUid: number,
  uidNext: number | null,
): Promise<number[]> {
  if (uidNext !== null && uidNext <= startUid) {
    return []
  }
  const uids =
    uidNext === null
      ? await connection.searchAll()
      : await connection.searchUids(`${startUid}:*`)
  return uids.filter((uid) => uid >= startUid).sort((left, right) => left - right)
}

async function backfillUids(
  connection: ImapConnection,
  minUid: number,
  limit: number,
): Promise<number[]> {
  if (minUid <= 1) {
    return (await connection.fetchUidsBySequence(1, limit)).sort((left, right) => left - right)
  }
  const start = Math.max(1, minUid - BACKFILL_WINDOW)
  let older = await connection.searchUids(`${start}:${minUid - 1}`)
  if (older.length === 0) {
    older = await connection.fetchUidsBySequence(1, limit)
  }
  return older
    .filter((uid) => uid < minUid)
    .sort((left, right) => left - right)
    .slice(-limit)
}

/**
 * Fill `snippet` and `search_text` for messages that were mirrored from headers
 * only.
 *
 * IMAP search runs against the D1 mirror, and a header-only mirror can only
 * match sender, recipients and subject. A few bodies per chunk (newest first)
 * slowly turn the mirror into something worth searching without turning every
 * sync into a full download.
 */
async function backfillSnippets(
  env: Env,
  connection: ImapConnection,
  account: AccountRow,
  folder: Folder,
  limit = SNIPPET_BATCH,
): Promise<number> {
  const pending = await env.DB.prepare(
    `SELECT id, uid FROM imap_messages
     WHERE account_id = ? AND folder = ? AND snippet = '' AND size <= ?
     ORDER BY uid DESC LIMIT ?`,
  )
    .bind(account.id, folder, MAX_INDEXED_BODY_BYTES, limit)
    .all<{ id: string; uid: number }>()
  let indexed = 0
  for (const row of pending.results) {
    try {
      const bytes = await connection.fetchFull(row.uid)
      const email = await parseFull(bytes)
      const text = bodyText(email)
      if (!text.trim()) {
        continue
      }
      await indexMessageText(env, row.id, text)
      indexed += 1
    } catch {
      // Transient fetch errors: the next chunk retries the same messages.
    }
  }
  return indexed
}

interface ThreadCandidate {
  id: string
  stableKey: string
  messageId: string | null
  inReplyTo: string | null
  references: string | null
  subject: string | null
}

/**
 * Conversation keys for a batch of messages.
 *
 * The parent row is looked up by `stable_key` (`mid:<message-id>`, indexed) in
 * both the raw and the bracket-less form, because providers disagree on how they
 * keep the header. A parent that has no key yet is a legacy row: its own
 * Message-ID becomes the root and it is repaired in the same batch, so old mail
 * joins the conversation without a rescan.
 */
async function resolveThreadKeys(
  env: Env,
  accountId: string,
  candidates: ThreadCandidate[],
): Promise<Map<string, string>> {
  const keys = new Map<string, string>()
  if (candidates.length === 0) {
    return keys
  }

  const variantsFor = (candidate: ThreadCandidate): string[] => {
    const raw = referenceIds(candidate.references)[0]
    const parent = candidate.inReplyTo?.trim()
    const values: string[] = []
    for (const value of [raw, parent]) {
      if (!value) {
        continue
      }
      const lower = value.toLowerCase()
      values.push(`mid:${lower}`, `mid:${normalizeMessageId(lower)}`)
    }
    return values
  }

  const wanted = new Set<string>()
  for (const candidate of candidates) {
    for (const variant of variantsFor(candidate)) {
      wanted.add(variant)
    }
  }

  const parents = new Map<
    string,
    { stableKey: string; threadKey: string | null; messageId: string | null }
  >()
  const list = [...wanted].slice(0, 100)
  if (list.length > 0) {
    const placeholders = list.map(() => '?').join(', ')
    const rows = await env.DB.prepare(
      `SELECT stable_key, thread_key, message_id FROM imap_messages WHERE account_id = ? AND stable_key IN (${placeholders})`,
    )
      .bind(accountId, ...list)
      .all<{ stable_key: string; thread_key: string | null; message_id: string | null }>()
    for (const row of rows.results) {
      parents.set(row.stable_key, {
        stableKey: row.stable_key,
        threadKey: row.thread_key ?? null,
        messageId: row.message_id,
      })
    }
  }

  // A reply that lost its References still shares the subject of its thread: use
  // the conversation already stored for that subject, the way Gmail does.
  const subjectKeys = new Map<string, string>()
  const subjects = new Set<string>()
  for (const candidate of candidates) {
    const normalized = normalizeSubject(candidate.subject)
    if (!normalized) {
      continue
    }
    subjects.add(normalized)
    subjects.add((candidate.subject ?? '').trim().toLowerCase())
  }
  const subjectList = [...subjects].slice(0, 100)
  if (subjectList.length > 0) {
    const placeholders = subjectList.map(() => '?').join(', ')
    const rows = await env.DB.prepare(
      `SELECT subject, COALESCE(thread_key, stable_key) AS key FROM imap_messages
       WHERE account_id = ? AND lower(subject) IN (${placeholders})`,
    )
      .bind(accountId, ...subjectList)
      .all<{ subject: string; key: string }>()
    for (const row of rows.results) {
      const normalized = normalizeSubject(row.subject)
      if (normalized && !subjectKeys.has(normalized)) {
        subjectKeys.set(normalized, row.key)
      }
    }
  }

  // A reply can answer a message the app sent: that copy lives in `messages`,
  // not in the mirror, so the conversation of the original has to be found there.
  const relayParents = new Map<string, { id: string; threadKey: string | null; messageId: string | null }>()
  const wantedParents = [
    ...new Set(
      candidates
        .map(
          (candidate) =>
            normalizeMessageId(candidate.inReplyTo) ||
            normalizeMessageId(referenceIds(candidate.references)[0]),
        )
        .filter(Boolean),
    ),
  ].slice(0, 100)
  if (wantedParents.length > 0) {
    const placeholders = wantedParents.map(() => '?').join(', ')
    const rows = await env.DB.prepare(
      `SELECT id, message_id, thread_key FROM messages
       WHERE account_id = ?
         AND lower(replace(replace(message_id, '<', ''), '>', '')) IN (${placeholders})`,
    )
      .bind(accountId, ...wantedParents)
      .all<{ id: string; message_id: string | null; thread_key: string | null }>()
    for (const row of rows.results) {
      const normalized = normalizeMessageId(row.message_id)
      if (normalized) {
        relayParents.set(normalized, {
          id: row.id,
          threadKey: row.thread_key ?? null,
          messageId: row.message_id,
        })
      }
    }
  }

  const repairs = new Map<string, string>()
  const relayRepairs = new Map<string, string>()
  for (const candidate of candidates) {
    const variants = variantsFor(candidate)
    const parent = variants.map((variant) => parents.get(variant)).find(Boolean) ?? null
    const legacyRoot =
      parent && !parent.threadKey ? normalizeMessageId(parent.messageId) : null
    if (parent && !parent.threadKey && legacyRoot) {
      repairs.set(parent.stableKey, legacyRoot)
    }
    // Subject matching is the fallback for replies that lost their headers: it
    // must not merge an unrelated message that shares a generic subject.
    const subjectKey =
      parent || !isReplySubject(candidate.subject)
        ? null
        : subjectKeys.get(normalizeSubject(candidate.subject)) ?? null
    const relayParent = parent
      ? null
      : relayParents.get(
          normalizeMessageId(candidate.inReplyTo) ||
            normalizeMessageId(referenceIds(candidate.references)[0]),
        ) ?? null
    const relayRoot =
      relayParent && !relayParent.threadKey ? normalizeMessageId(relayParent.messageId) : null
    if (relayParent && !relayParent.threadKey && relayRoot) {
      relayRepairs.set(relayParent.id, relayRoot)
    }
    keys.set(
      candidate.id,
      threadKeyFor({
        messageId: candidate.messageId,
        inReplyTo: candidate.inReplyTo,
        references: candidate.references,
        parentKey: parent?.threadKey ?? legacyRoot ?? relayParent?.threadKey ?? relayRoot ?? subjectKey,
        fallback: candidate.stableKey,
      }),
    )
  }

  if (repairs.size > 0) {
    await env.DB.batch(
      [...repairs].map(([stableKey, key]) =>
        env.DB.prepare(
          'UPDATE imap_messages SET thread_key = ? WHERE account_id = ? AND stable_key = ? AND thread_key IS NULL',
        ).bind(key, accountId, stableKey),
      ),
    )
  }
  if (relayRepairs.size > 0) {
    await env.DB.batch(
      [...relayRepairs].map(([id, key]) =>
        env.DB.prepare('UPDATE messages SET thread_key = ? WHERE id = ? AND thread_key IS NULL').bind(
          key,
          id,
        ),
      ),
    )
  }
  return keys
}

/**
 * Rows mirrored before threading existed have no key. Reading their headers (not
 * the bodies) is enough to place them, a few per sync run.
 */
export async function backfillThreadKeys(
  env: Env,
  connection: ImapConnection,
  account: AccountRow,
  folder: Folder,
  limit = 10,
): Promise<number> {
  const pending = await env.DB.prepare(
    `SELECT id, uid, stable_key, message_id FROM imap_messages
     WHERE account_id = ? AND folder = ? AND thread_key IS NULL
     ORDER BY uid DESC LIMIT ?`,
  )
    .bind(account.id, folder, limit)
    .all<{ id: string; uid: number; stable_key: string; message_id: string | null }>()
  if (pending.results.length === 0) {
    return 0
  }
  const headers = await connection.fetchHeaders(pending.results.map((row) => row.uid))
  const byUid = new Map(headers.map((header) => [header.uid, header.header]))
  const candidates: ThreadCandidate[] = []
  for (const row of pending.results) {
    const raw = byUid.get(row.uid)
    if (!raw) {
      continue
    }
    const email = await parseHeaders(raw)
    candidates.push({
      id: row.id,
      stableKey: row.stable_key,
      messageId: email.messageId ?? row.message_id,
      inReplyTo: email.inReplyTo ?? null,
      references: email.references ?? null,
      subject: email.subject ?? null,
    })
  }
  const keys = await resolveThreadKeys(env, account.id, candidates)
  if (keys.size === 0) {
    return 0
  }
  await env.DB.batch(
    [...keys].map(([id, key]) =>
      env.DB.prepare('UPDATE imap_messages SET thread_key = ? WHERE id = ? AND thread_key IS NULL').bind(
        key,
        id,
      ),
    ),
  )
  return keys.size
}

const SYNC_LOCK_TTL_MS = 5 * 60 * 1000

interface SyncLock {
  expiresAt: number
  owner: string | null
}

async function acquireSyncLock(
  env: Env,
  accountId: string,
  folder: Folder,
): Promise<SyncLock | null> {
  const key = `${accountId}:${folder}`
  const now = Date.now()
  const expiresAt = now + SYNC_LOCK_TTL_MS
  const owner = crypto.randomUUID()
  try {
    const result = await env.DB.prepare(
      `INSERT INTO imap_sync_locks (lock_key, expires_at, owner) VALUES (?, ?, ?)
       ON CONFLICT(lock_key) DO UPDATE SET expires_at = excluded.expires_at, owner = excluded.owner
       WHERE imap_sync_locks.expires_at < ?`,
    )
      .bind(key, expiresAt, owner, now)
      .run()
    return (result.meta.changes ?? 0) > 0 ? { expiresAt, owner } : null
  } catch (error) {
    if (isSchemaError(error)) {
      // Older databases may not have the lock table or owner column; run unlocked.
      return { expiresAt: 0, owner: null }
    }
    throw error
  }
}

async function renewSyncLock(
  env: Env,
  accountId: string,
  folder: Folder,
  lock: SyncLock,
): Promise<void> {
  if (!lock.owner) {
    return
  }
  try {
    const result = await env.DB.prepare(
      'UPDATE imap_sync_locks SET expires_at = ? WHERE lock_key = ? AND owner = ?',
    )
      .bind(Date.now() + SYNC_LOCK_TTL_MS, `${accountId}:${folder}`, lock.owner)
      .run()
    if ((result.meta.changes ?? 0) === 0) {
      throw new Error('Sync lock lost to another worker')
    }
  } catch (error) {
    if (isSchemaError(error)) {
      return
    }
    throw error
  }
}

async function releaseSyncLock(
  env: Env,
  accountId: string,
  folder: Folder,
  lock: SyncLock,
): Promise<void> {
  if (!lock.owner) {
    return
  }
  try {
    await env.DB.prepare(
      'DELETE FROM imap_sync_locks WHERE lock_key = ? AND owner = ?',
    )
      .bind(`${accountId}:${folder}`, lock.owner)
      .run()
  } catch {
    // The lock expires on its own; release is best effort.
  }
}

export async function cleanupExpiredSyncLocks(env: Env): Promise<void> {
  try {
    await env.DB.prepare('DELETE FROM imap_sync_locks WHERE expires_at < ?')
      .bind(Date.now())
      .run()
  } catch (error) {
    if (!isSchemaError(error)) {
      throw error
    }
  }
}

export async function runSyncChunk(
  env: Env,
  account: AccountRow,
  folder: Folder,
): Promise<{ folders: MailboxSyncState[]; hasMore: boolean; locked?: boolean }> {
  const lock = await acquireSyncLock(env, account.id, folder)
  if (!lock) {
    console.log(`[sync] ${account.id}/${folder} skipped (lock held by another worker)`)
    const folders = await getSyncStates(env, account.id)
    const current = folders.find((item) => item.folder === folder)
    // `locked` tells the caller "not mine, do not keep asking": the owner will
    // finish the chunk and the next list load resumes the chain.
    return {
      folders,
      hasMore: current ? current.status === 'partial' : false,
      locked: true,
    }
  }
  try {
    return await runSyncChunkLocked(env, account, folder, lock)
  } finally {
    await releaseSyncLock(env, account.id, folder, lock)
  }
}

async function runSyncChunkLocked(
  env: Env,
  account: AccountRow,
  folder: Folder,
  lock: SyncLock,
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
  let indexedSnippets = 0

  const syncStartedAt = Date.now()

  await withImap(env, account, async (connection) => {
    await renewSyncLock(env, account.id, folder, lock)
    const target = await resolveFolderName(env, connection, account, folder)
    let details
    try {
      details = await connection.selectWithDetails(target)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (folder !== 'spam' || !MISSING_FOLDER.test(detail)) {
        throw error
      }
      try {
        await connection.create(target)
      } catch {
        // It may already exist.
      }
      details = await connection.selectWithDetails(target)
    }
    uidValidity = details.uidValidity
    const uidNext = details.uidNext

    if (shouldResetOnUidValidity(row?.uid_validity, details.uidValidity)) {
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
      await env.DB.prepare(
        'DELETE FROM imap_body_cache WHERE account_id = ? AND folder = ?',
      )
        .bind(account.id, folder)
        .run()
        .catch(() => undefined)
      maxUid = 0
      minUid = 0
      backfillDone = false
    }

    if (backfillDone && shouldResumeBackfill(row, details.exists)) {
      backfillDone = false
      console.log(
        `[sync] ${account.id}/${folder} resuming incomplete backfill mirror=${row?.synced ?? 0} total=${details.exists}`,
      )
    }

    let uidsToFetch: number[] = []
    let phase: 'new' | 'backfill' | 'idle' = 'idle'

    if (maxUid === 0) {
      const recent = await connection.searchRecentUids(chunkSize, uidNext)
      if (recent.length > 0) {
        uidsToFetch = recent.slice(-chunkSize)
        phase = 'new'
      } else if ((details.exists ?? 0) > 0) {
        const allUids = (await connection.searchAll()).sort((left, right) => left - right)
        uidsToFetch = allUids.slice(-chunkSize)
        phase = 'new'
      }
    } else {
      const newUids = await newUidsSince(connection, maxUid + 1, uidNext)
      if (newUids.length > 0) {
        uidsToFetch = newUids.slice(0, chunkSize)
        phase = 'new'
      } else if (!backfillDone) {
        const older = await backfillUids(connection, minUid, chunkSize)
        if (older.length > 0) {
          uidsToFetch = older
          phase = 'backfill'
        }
      }
    }

    const now = new Date().toISOString()

    if (uidsToFetch.length > 0) {
      const headers = await connection.fetchHeaders(uidsToFetch)
      const parsed: {
        header: ImapHeader
        row: ImapMessageRow
        id: string
        stableKey: string
        folder: Folder
        inReplyTo: string | null
        references: string | null
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
          inReplyTo: email.inReplyTo ?? null,
          references: email.references ?? null,
          row: {
            id,
            account_id: account.id,
            folder,
            uid: header.uid,
            uid_validity: details.uidValidity,
            stable_key: key,
            message_id: email.messageId ?? null,
            thread_key: null,
            from_name: from.name,
            from_email: from.email,
            to_json: JSON.stringify(toMailboxes(email.to)),
            cc_json: JSON.stringify(toMailboxes(email.cc)),
            bcc_json: JSON.stringify(toMailboxes(email.bcc)),
            subject: email.subject ?? '',
            snippet: '',
            search_text: '',
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
        const threadKeys = await resolveThreadKeys(
          env,
          account.id,
          parsed.map((item) => ({
            id: item.id,
            stableKey: item.stableKey,
            messageId: item.row.message_id,
            inReplyTo: item.inReplyTo,
            references: item.references,
            subject: item.row.subject,
          })),
        )
        for (const item of parsed) {
          item.row.thread_key = threadKeys.get(item.id) ?? item.stableKey
        }
        await env.DB.batch(
          parsed.map((item) =>
            env.DB.prepare(
              `INSERT INTO imap_messages (id, account_id, folder, uid, uid_validity, stable_key, message_id, thread_key, from_name, from_email, to_json, cc_json, bcc_json, subject, snippet, sent_at, size, unread, has_attachments, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET uid_validity = excluded.uid_validity, stable_key = excluded.stable_key, message_id = excluded.message_id, thread_key = coalesce(excluded.thread_key, imap_messages.thread_key), from_name = excluded.from_name, from_email = excluded.from_email, to_json = excluded.to_json, cc_json = excluded.cc_json, bcc_json = excluded.bcc_json, subject = excluded.subject, snippet = excluded.snippet, sent_at = excluded.sent_at, size = excluded.size, unread = excluded.unread, has_attachments = excluded.has_attachments, updated_at = excluded.updated_at`,
            ).bind(
              item.row.id,
              item.row.account_id,
              item.row.folder,
              item.row.uid,
              item.row.uid_validity,
              item.row.stable_key,
              item.row.message_id,
              item.row.thread_key,
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
        const summaries = parsed.map((item) => imapMessageSummary(item.row, account))
        if (folder === 'inbox') {
          await applyFilters(env, account.id, summaries)
        }
        await applyAccountLabel(env, account.id, account.incoming_label_id, summaries)
      }

      if (archiveStorage && parsed.length > 0) {
        await renewSyncLock(env, account.id, folder, lock)
        const updates: D1PreparedStatement[] = []
        for (const [index, item] of parsed.entries()) {
          if (index > 0 && index % 4 === 0) {
            await renewSyncLock(env, account.id, folder, lock)
          }
          try {
            const bytes = await connection.fetchFull(item.header.uid)
            try {
              await indexMessageText(env, item.id, bodyText(await parseFull(bytes)))
            } catch {
              // Indexing is best effort; the snippet backfill retries later.
            }
            const key = `imap/${account.id}/${folder}/${details.uidValidity ?? 0}/${folder}-${item.header.uid}.eml`
            const stored = await archiveStorage.put(key, bytes, 'message/rfc822')
            updates.push(
              archiveUpdateStatement(env, {
                id: item.id,
                key: stored.key,
                driver: archiveStorage.driver,
              }),
            )
          } catch {
            // Keep the message on the provider if the archive write fails.
          }
        }
        if (updates.length > 0) {
          await env.DB.batch(updates)
        }
      }

      const nextWindow = advanceSyncWindow({ maxUid, minUid }, uidsToFetch, phase)
      maxUid = nextWindow.maxUid
      minUid = nextWindow.minUid
    }

    if (archiveStorage) {
      await renewSyncLock(env, account.id, folder, lock)
      const pending = await env.DB.prepare(
        'SELECT id, uid FROM imap_messages WHERE account_id = ? AND folder = ? AND archived = 0 ORDER BY uid ASC LIMIT ?',
      )
        .bind(account.id, folder, chunkSize)
        .all<{ id: string; uid: number }>()
      const updates: D1PreparedStatement[] = []
      for (const [index, item] of pending.results.entries()) {
        if (index > 0 && index % 4 === 0) {
          await renewSyncLock(env, account.id, folder, lock)
        }
        try {
          const bytes = await connection.fetchFull(item.uid)
          try {
            await indexMessageText(env, item.id, bodyText(await parseFull(bytes)))
          } catch {
            // Indexing is best effort; the snippet backfill retries later.
          }
          const key = `imap/${account.id}/${folder}/${details.uidValidity ?? 0}/${folder}-${item.uid}.eml`
          const stored = await archiveStorage.put(key, bytes, 'message/rfc822')
          updates.push(
            archiveUpdateStatement(env, {
                id: item.id,
                key: stored.key,
                driver: archiveStorage.driver,
              }),
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

    if (maxUid > 0) {
      await renewSyncLock(env, account.id, folder, lock)
      const flagStart = Math.max(1, maxUid - FLAG_WINDOW)
      const flagUids = await connection.searchUids(`${flagStart}:${maxUid}`)
      const flags = await connection.fetchFlags(flagUids)
      const updates: D1PreparedStatement[] = []
      for (const item of flags) {
        const unread =
          folder === 'draft' || item.flags.some((flag) => flag.toLowerCase() === '\\seen') ? 0 : 1
        updates.push(
          env.DB.prepare(
            'UPDATE imap_messages SET unread = ?, updated_at = ? WHERE account_id = ? AND folder = ? AND uid = ? AND unread <> ?',
          ).bind(unread, now, account.id, folder, item.uid, unread),
        )
      }
      if (updates.length > 0) {
        await env.DB.batch(updates)
      }
    }

    await renewSyncLock(env, account.id, folder, lock)
    indexedSnippets = await backfillSnippets(env, connection, account, folder)
    await backfillThreadKeys(env, connection, account, folder).catch(() => 0)

    let hasOlder = false
    if (!backfillDone) {
      if (details.exists === 0 || minUid <= 1) {
        backfillDone = true
      } else {
        try {
          const lowest = await connection.firstUid()
          backfillDone = isBackfillComplete({
            exists: details.exists,
            minUid,
            lowestUid: lowest,
          })
          hasOlder = !backfillDone
        } catch {
          hasOlder = true
        }
      }
    }

    let hasNew: boolean
    if (uidNext !== null) {
      hasNew =
        uidNext > maxUid + 1 ? (await connection.searchUids(`${maxUid + 1}:*`)).length > 0 : false
    } else {
      hasNew = (await connection.searchAll()).some((uid) => uid > maxUid)
    }

    const hasMore = hasNew || hasOlder || archiveMore

    let synced = await countMessages(env, account.id, folder)
    if (!hasMore) {
      const needsPrune = details.exists === null || details.exists !== synced
      if (needsPrune) {
        await renewSyncLock(env, account.id, folder, lock)
        const currentUids = (await connection.searchAll()).sort((left, right) => left - right)
        if (currentUids.length > 0 || synced > 0) {
          await pruneFolder(
            env,
            account.id,
            folder,
            currentUids,
            account,
            Boolean(account.delete_after_archive),
          )
          synced = await countMessages(env, account.id, folder)
        }
      }
    }

    await upsertSyncState(env, account.id, folder, {
      uidValidity,
      maxUid,
      minUid,
      backfillDone,
      status: hasMore ? 'partial' : 'done',
      error: null,
      total: details.exists ?? synced,
      synced,
      lastSyncedAt: new Date().toISOString(),
    })
  })

  console.log(
    `[sync] ${account.id}/${folder} ${Date.now() - syncStartedAt}ms maxUid=${maxUid} minUid=${minUid} backfillDone=${backfillDone} indexed=${indexedSnippets}`,
  )

  const folders = await getSyncStates(env, account.id)
  const current = folders.find((item) => item.folder === folder)
  return {
    folders,
    hasMore: current ? current.status === 'partial' : false,
  }
}
