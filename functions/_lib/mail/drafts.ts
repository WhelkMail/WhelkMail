import { getAccountRow, type MessageRow } from '../db'
import type { Env } from '../env'
import { queueSync } from '../sync'
import { deleteDraft } from './imap'
import { parseImapMessageId, parseRelayMessageId } from './ids'
import { parseImapPointer, removeStoredCopy } from './relay-target'

export async function deleteDraftById(
  env: Env,
  id: string,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<void> {
  const imapId = parseImapMessageId(id)
  if (imapId) {
    if (imapId.folder !== 'draft') {
      return
    }
    const account = await getAccountRow(env, imapId.accountId)
    if (!account || account.kind !== 'imap') {
      return
    }
    await deleteDraft(env, account, imapId.uid)
    return
  }

  const relayId = parseRelayMessageId(id)
  if (!relayId) {
    return
  }
  const row = await env.DB.prepare('SELECT * FROM messages WHERE id = ?')
    .bind(relayId)
    .first<MessageRow>()
  if (!row || row.folder !== 'draft') {
    return
  }
  const account = await getAccountRow(env, row.account_id)
  if (account) {
    try {
      await removeStoredCopy(env, account, row.storage_driver, row.storage_key)
    } catch {
      // best effort
    }
  }
  // The draft was a real message in another mailbox: refresh that folder so the
  // deleted copy does not linger in the mirror as a ghost draft.
  const pointer = parseImapPointer(row.storage_key)
  if (pointer && waitUntil) {
    const target = await getAccountRow(env, pointer.accountId)
    if (target) {
      await queueSync(env, target, 'draft', waitUntil).catch(() => undefined)
    }
  }
  await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(relayId).run()
}
