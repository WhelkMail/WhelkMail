import type { Folder } from '../../../shared/types'
import { getAccountRow, type AccountRow, type MessageRow } from '../db'
import type { Env } from '../env'
import { isSchemaError } from '../schema'
import { getImapArchiveStorage, getStorage } from '../storage'
import { fetchMessage, markMessageSeen } from './imap'
import { parseImapMessageId, parseRelayMessageId } from './ids'

export interface LoadedRaw {
  bytes: Uint8Array
  account: AccountRow
  folder: Folder
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
            if (markRead && imapId.folder === 'inbox') {
              try {
                await markMessageSeen(env, account, imapId.folder, imapId.uid)
              } catch {
                // non-blocking
              }
            }
            return { bytes, account, folder: imapId.folder }
          }
        }
      } catch (error) {
        if (!isSchemaError(error)) {
          throw error
        }
      }
    }
    const bytes = await fetchMessage(env, account, imapId.folder, imapId.uid, markRead)
    return { bytes, account, folder: imapId.folder }
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
  return { bytes, account, folder: row.folder as Folder }
}
