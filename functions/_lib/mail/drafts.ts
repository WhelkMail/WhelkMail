import { getAccountRow, type MessageRow } from '../db'
import type { Env } from '../env'
import { getStorage } from '../storage'
import { deleteDraft } from './imap'
import { parseImapMessageId, parseRelayMessageId } from './ids'

export async function deleteDraftById(env: Env, id: string): Promise<void> {
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
      const storage = await getStorage(env, account)
      await storage.remove(row.storage_key)
    } catch {
      // best effort
    }
  }
  await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(relayId).run()
}
