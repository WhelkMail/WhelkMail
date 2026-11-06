import { messageLabelsSchema } from '../../../../shared/schemas'
import type { Env } from '../../../_lib/env'
import { fail, json, readJson } from '../../../_lib/http'
import { parseImapMessageId, parseRelayMessageId } from '../../../_lib/mail/ids'
import type { MessageRow } from '../../../_lib/db'
import { isSchemaError, schemaOutdated } from '../../../_lib/schema'

async function resolveTarget(
  env: Env,
  id: string,
): Promise<{ accountId: string; folder: string } | null> {
  const imapId = parseImapMessageId(id)
  if (imapId) {
    return { accountId: imapId.accountId, folder: imapId.folder }
  }
  const relayId = parseRelayMessageId(id)
  if (!relayId) {
    return null
  }
  const row = await env.DB.prepare('SELECT account_id, folder FROM messages WHERE id = ?')
    .bind(relayId)
    .first<Pick<MessageRow, 'account_id' | 'folder'>>()
  if (!row) {
    return null
  }
  return { accountId: row.account_id, folder: row.folder }
}

export const onRequestPut: PagesFunction<Env> = async (context) => {
  try {
    return await putLabels(context)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

async function putLabels(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const id = context.params.id as string
  const target = await resolveTarget(context.env, id)
  if (!target) {
    return fail('Message not found', 404, undefined, 'message_not_found')
  }
  const body = await readJson<unknown>(context.request)
  const parsed = messageLabelsSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid labels',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'label_invalid',
    )
  }
  const labelIds = [...new Set(parsed.data.labelIds)]

  if (labelIds.length > 0) {
    const placeholders = labelIds.map(() => '?').join(', ')
    const found = await context.env.DB.prepare(
      `SELECT id FROM labels WHERE id IN (${placeholders})`,
    )
      .bind(...labelIds)
      .all<{ id: string }>()
    if (found.results.length !== labelIds.length) {
      return fail('Label not found', 404, undefined, 'label_not_found')
    }
  }

  const createdAt = new Date().toISOString()
  const statements = [
    context.env.DB.prepare('DELETE FROM message_labels WHERE message_id = ?').bind(id),
  ]
  for (const labelId of labelIds) {
    statements.push(
      context.env.DB.prepare(
        'INSERT INTO message_labels (message_id, account_id, folder, label_id, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(id, target.accountId, target.folder, labelId, createdAt),
    )
  }
  await context.env.DB.batch(statements)
  return json({ ok: true, labelIds })
}
