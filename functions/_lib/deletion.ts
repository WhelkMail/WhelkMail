import type { DeletionLog } from '../../shared/types'
import type { AccountRow } from './db'
import type { Env } from './env'
import { moveToTrash } from './mail/imap'
import { parseImapMessageId } from './mail/ids'
import { parseImapPointer } from './mail/relay-target'
import { getStorage } from './storage'
import { DriveStorage } from './storage/drive'
import { R2Storage } from './storage/r2'
import type { ImapMessageRow } from './sync'

interface DeletionLogRow {
  id: string
  account_id: string
  message_id: string
  status: string
  error: string | null
  created_at: string
}

export async function listDeletionLogs(
  env: Env,
  accountId: string,
  limit = 20,
): Promise<DeletionLog[]> {
  const rows = await env.DB.prepare(
    'SELECT * FROM deletion_log WHERE account_id = ? ORDER BY created_at DESC LIMIT ?',
  )
    .bind(accountId, limit)
    .all<DeletionLogRow>()
  return rows.results.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    messageId: row.message_id,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
  }))
}

async function logDeletion(
  env: Env,
  accountId: string,
  messageId: string,
  status: string,
  error: string | null = null,
): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO deletion_log (id, account_id, message_id, status, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET status = excluded.status, error = excluded.error, updated_at = excluded.updated_at`,
  )
    .bind(crypto.randomUUID(), accountId, messageId, status, error, now, now)
    .run()
}

export async function deleteArchivedMessage(
  env: Env,
  account: AccountRow,
  message: ImapMessageRow,
): Promise<string> {
  if (!account.delete_after_archive || !account.archive_imap_bodies) {
    return 'disabled'
  }
  if (message.folder !== 'inbox') {
    return 'skipped'
  }
  if (!message.archived || !message.archive_key) {
    return 'not_archived'
  }
  const existing = await env.DB.prepare(
    'SELECT status FROM deletion_log WHERE message_id = ?',
  )
    .bind(message.id)
    .first<{ status: string }>()
  if (existing?.status === 'done') {
    return 'done'
  }
  const parsed = parseImapMessageId(message.id)
  if (!parsed) {
    await logDeletion(env, account.id, message.id, 'failed', 'ID messaggio non valido')
    return 'failed'
  }
  try {
    await moveToTrash(env, account, parsed.folder, parsed.uid)
    await logDeletion(env, account.id, message.id, 'done')
    return 'done'
  } catch (error) {
    await logDeletion(
      env,
      account.id,
      message.id,
      'failed',
      error instanceof Error ? error.message : String(error),
    )
    return 'failed'
  }
}

export async function purgeAccountStorage(env: Env, account: AccountRow): Promise<void> {
  const keys = new Set<string>()
  try {
    const messages = await env.DB.prepare('SELECT storage_key FROM messages WHERE account_id = ?')
      .bind(account.id)
      .all<{ storage_key: string }>()
    for (const row of messages.results) {
      // Pointers refer to mail kept in an IMAP mailbox: account deletion must
      // never remove messages from the provider.
      if (row.storage_key && !parseImapPointer(row.storage_key)) {
        keys.add(row.storage_key)
      }
    }
    const archived = await env.DB.prepare(
      'SELECT archive_key FROM imap_messages WHERE account_id = ? AND archive_key IS NOT NULL',
    )
      .bind(account.id)
      .all<{ archive_key: string }>()
    for (const row of archived.results) {
      if (row.archive_key) {
        keys.add(row.archive_key)
      }
    }
  } catch {
    return
  }
  if (keys.size === 0) {
    return
  }
  let storage
  try {
    if (account.kind === 'imap') {
      storage =
        account.imap_archive_driver === 'drive'
          ? account.drive_refresh_token_enc
            ? new DriveStorage(env, account)
            : null
          : env.BUCKET
            ? new R2Storage(env)
            : null
    } else {
      storage = account.storage_driver === 'imap' ? null : await getStorage(env, account)
    }
  } catch {
    return
  }
  if (!storage) {
    return
  }
  const list = [...keys]
  for (let index = 0; index < list.length; index += 20) {
    await Promise.allSettled(list.slice(index, index + 20).map((key) => storage.remove(key)))
  }
}
