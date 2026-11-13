import { z } from 'zod'
import type { Folder } from '../../../shared/types'
import { getAccountRow, type AccountRow } from '../../_lib/db'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { moveMessages } from '../../_lib/mail/imap'
import { parseImapMessageId, parseRelayMessageId } from '../../_lib/mail/ids'
import { removeStoredCopy } from '../../_lib/mail/relay-target'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'
import { queueSync } from '../../_lib/sync'

const actionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(['delete', 'spam', 'move']),
  target: z.enum(['inbox', 'spam', 'trash']).optional(),
})

interface ImapGroup {
  accountId: string
  folder: Folder
  ids: string[]
  uids: number[]
}

interface ActionError {
  ids: string[]
  message: string
}

async function removeMirrorRows(env: Env, ids: string[]): Promise<void> {
  for (let index = 0; index < ids.length; index += 50) {
    const chunk = ids.slice(index, index + 50)
    const placeholders = chunk.map(() => '?').join(', ')
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM message_labels WHERE message_id IN (${placeholders})`).bind(
        ...chunk,
      ),
      env.DB.prepare(`DELETE FROM imap_messages WHERE id IN (${placeholders})`).bind(...chunk),
    ])
  }
}

async function deleteRelayMessages(
  env: Env,
  ids: string[],
  errors: ActionError[],
): Promise<number> {
  let deleted = 0
  for (const id of ids) {
    const rawId = parseRelayMessageId(id)
    if (!rawId) {
      continue
    }
    const row = await env.DB.prepare(
      'SELECT account_id, storage_driver, storage_key FROM messages WHERE id = ?',
    )
      .bind(rawId)
      .first<{ account_id: string; storage_driver: string; storage_key: string }>()
    if (!row) {
      errors.push({ ids: [id], message: 'Message not found' })
      continue
    }
    const account = await getAccountRow(env, row.account_id)
    if (account) {
      try {
        await removeStoredCopy(env, account, row.storage_driver, row.storage_key)
      } catch {
        // The D1 row is still removed if the copy cleanup fails.
      }
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM message_labels WHERE message_id = ?').bind(id),
      env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(rawId),
    ])
    deleted += 1
  }
  return deleted
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    return await runActions(context)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

async function runActions(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const body = await readJson<unknown>(context.request)
  const parsed = actionSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid action',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'action_invalid',
    )
  }
  const { ids, action } = parsed.data
  const target: 'inbox' | 'spam' | 'trash' =
    action === 'delete' ? 'trash' : action === 'spam' ? 'spam' : (parsed.data.target ?? 'inbox')

  const groups = new Map<string, ImapGroup>()
  const relayIds: string[] = []
  const errors: ActionError[] = []
  for (const id of [...new Set(ids)]) {
    const imap = parseImapMessageId(id)
    if (imap) {
      const key = `${imap.accountId}|${imap.folder}`
      const group = groups.get(key) ?? {
        accountId: imap.accountId,
        folder: imap.folder,
        ids: [],
        uids: [],
      }
      group.ids.push(id)
      group.uids.push(imap.uid)
      groups.set(key, group)
      continue
    }
    if (parseRelayMessageId(id)) {
      relayIds.push(id)
      continue
    }
    errors.push({ ids: [id], message: 'Invalid message ID' })
  }

  const queued = new Set<string>()
  async function queue(account: AccountRow, folder: Folder): Promise<void> {
    const key = `${account.id}:${folder}`
    if (queued.has(key)) {
      return
    }
    queued.add(key)
    await queueSync(context.env, account, folder, (promise) => context.waitUntil(promise)).catch(
      () => undefined,
    )
  }

  let moved = 0
  const skipped: string[] = []
  for (const group of groups.values()) {
    if (target === group.folder) {
      skipped.push(...group.ids)
      continue
    }
    const account = await getAccountRow(context.env, group.accountId)
    if (!account || account.kind !== 'imap' || !account.secret_enc) {
      errors.push({ ids: group.ids, message: 'Account not available' })
      continue
    }
    try {
      await moveMessages(context.env, account, group.folder, group.uids, target)
      if (target === 'trash') {
        await removeMirrorRows(context.env, group.ids)
      }
      if (target === 'inbox' && group.folder !== 'inbox') {
        await queue(account, 'inbox')
      } else if (target === 'spam' && group.folder !== 'spam') {
        await queue(account, 'spam')
      }
      await queue(account, group.folder)
      moved += group.ids.length
    } catch (error) {
      errors.push({
        ids: group.ids,
        message: error instanceof Error ? error.message : 'IMAP error',
      })
    }
  }

  if (relayIds.length > 0) {
    if (target !== 'trash') {
      errors.push({
        ids: relayIds,
        message: 'Moving messages is not supported for send-only accounts',
      })
    } else {
      moved += await deleteRelayMessages(context.env, relayIds, errors)
    }
  }

  return json({ ok: true, moved, skipped, errors })
}
