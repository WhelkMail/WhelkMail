import type { Folder } from '../../../shared/types'
import { getCachedBody, putCachedBody } from '../body-cache'
import { getAccountRow, type AccountRow, type MessageRow } from '../db'
import type { Env } from '../env'
import { isSchemaError } from '../schema'
import { getImapArchiveStorage, getStorage } from '../storage'
import { fetchMessage } from './imap'
import { parseImapMessageId, parseRelayMessageId } from './ids'

async function markMirrorRead(env: Env, id: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare('SELECT unread FROM imap_messages WHERE id = ?')
      .bind(id)
      .first<{ unread: number }>()
    await env.DB.prepare(
      'UPDATE imap_messages SET unread = 0, updated_at = ? WHERE id = ?',
    )
      .bind(new Date().toISOString(), id)
      .run()
    return row ? row.unread === 1 : true
  } catch {
    // The mirror may not exist yet; the next sync will reconcile it.
    return true
  }
}

export interface LoadedRaw {
  bytes: Uint8Array
  account: AccountRow
  folder: Folder
  source: 'imap' | 'archive' | 'cache' | 'storage'
  needsSeen: boolean
}

export async function loadRaw(
  env: Env,
  id: string,
  markRead = false,
): Promise<LoadedRaw | null> {
  const imapId = parseImapMessageId(id)
  if (imapId) {
    const account = await getAccountRow(env, imapId.accountId)
    if (!account || account.kind !== 'imap') {
      return null
    }
    const cached = await getCachedBody(env, id)
    if (cached) {
      const needsSeen =
        markRead &&
        (imapId.folder === 'inbox' || imapId.folder === 'spam') &&
        (await markMirrorRead(env, id))
      return { bytes: cached, account, folder: imapId.folder, source: 'cache', needsSeen }
    }
    const archiveStorage = getImapArchiveStorage(env, account)
    if (archiveStorage) {
      try {
        const mirror = await env.DB.prepare(
          'SELECT archive_key FROM imap_messages WHERE id = ?',
        )
          .bind(id)
          .first<{ archive_key: string | null }>()
        if (mirror?.archive_key) {
          const object = await archiveStorage.get(mirror.archive_key)
          if (object) {
            const bytes = new Uint8Array(await new Response(object.body).arrayBuffer())
            const needsSeen =
              markRead &&
              (imapId.folder === 'inbox' || imapId.folder === 'spam') &&
              (await markMirrorRead(env, id))
            await putCachedBody(env, id, bytes)
            return { bytes, account, folder: imapId.folder, source: 'archive', needsSeen }
          }
        }
      } catch (error) {
        if (!isSchemaError(error)) {
          throw error
        }
      }
    }
    const bytes = await fetchMessage(env, account, imapId.folder, imapId.uid, markRead)
    if (markRead && (imapId.folder === 'inbox' || imapId.folder === 'spam')) {
      await markMirrorRead(env, id)
    }
    await putCachedBody(env, id, bytes)
    return { bytes, account, folder: imapId.folder, source: 'imap', needsSeen: false }
  }

  const relayId = parseRelayMessageId(id)
  if (!relayId) {
    return null
  }
  const row = await env.DB.prepare('SELECT * FROM messages WHERE id = ?')
    .bind(relayId)
    .first<MessageRow>()
  if (!row) {
    return null
  }
  const account = await getAccountRow(env, row.account_id)
  if (!account) {
    return null
  }
  const storage = await getStorage(env, account)
  const object = await storage.get(row.storage_key)
  if (!object) {
    return null
  }
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer())
  return { bytes, account, folder: row.folder as Folder, source: 'storage', needsSeen: false }
}
