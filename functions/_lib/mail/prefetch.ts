import type { Folder } from '../../../shared/types'
import {
  bodyCacheAvailable,
  getCachedBody,
  MAX_CACHED_BODY_BYTES,
  putCachedBody,
} from '../body-cache'
import type { AccountRow } from '../db'
import type { Env } from '../env'
import { resolveFolderName, withImap } from './imap'
import { parseImapMessageId } from './ids'

export async function prefetchMessageBodies(
  env: Env,
  account: AccountRow,
  folder: Folder,
  ids: string[],
  limit = 3,
): Promise<void> {
  const candidates: { id: string; uid: number }[] = []
  for (const id of ids) {
    if (candidates.length >= limit) {
      break
    }
    const parsed = parseImapMessageId(id)
    if (!parsed || parsed.accountId !== account.id || parsed.folder !== folder) {
      continue
    }
    if (await getCachedBody(env, id)) {
      continue
    }
    candidates.push({ id, uid: parsed.uid })
  }
  if (candidates.length === 0 || !bodyCacheAvailable()) {
    return
  }
  const sizes = new Map<string, number>()
  try {
    const placeholders = candidates.map(() => '?').join(', ')
    const rows = await env.DB.prepare(
      `SELECT id, size FROM imap_messages WHERE id IN (${placeholders})`,
    )
      .bind(...candidates.map((item) => item.id))
      .all<{ id: string; size: number }>()
    for (const row of rows.results) {
      sizes.set(row.id, row.size)
    }
  } catch {
    // The mirror may not contain the message yet; fetch it and let the cache decide.
  }
  const toFetch = candidates.filter((item) => {
    const size = sizes.get(item.id)
    return size === undefined || size <= MAX_CACHED_BODY_BYTES
  })
  if (toFetch.length === 0) {
    return
  }
  await withImap(env, account, async (connection) => {
    const target = await resolveFolderName(env, connection, account, folder)
    await connection.select(target)
    const bodies = await connection.fetchFullMany(toFetch.map((item) => item.uid))
    for (const item of toFetch) {
      const bytes = bodies.get(item.uid)
      if (bytes) {
        await putCachedBody(
          env,
          { messageId: item.id, accountId: account.id, folder, uid: item.uid },
          bytes,
        )
      }
    }
  })
}
