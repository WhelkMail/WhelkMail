import type { MessageSummary } from '../../../shared/types'
import {
  getAccountRow,
  relayMessageSummary,
  type MessageRow,
} from '../../_lib/db'
import type { Env } from '../../_lib/env'
import { fail, json } from '../../_lib/http'
import { isSchemaError } from '../../_lib/schema'
import { imapMessageSummary, type ImapMessageRow } from '../../_lib/sync'

/**
 * Every message of one conversation, oldest first.
 *
 * The thread is looked up across Inbox, Sent and Spam of the account so that your
 * replies appear in the conversation, like Gmail. Drafts are excluded: they are
 * work in progress, not part of the history.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const accountId = url.searchParams.get('accountId') ?? ''
  const threadKey = url.searchParams.get('threadKey') ?? ''
  if (!accountId || !threadKey) {
    return fail('accountId and threadKey are required', 400, undefined, 'thread_invalid')
  }
  const account = await getAccountRow(context.env, accountId)
  if (!account) {
    return fail('Account not found', 404, undefined, 'account_not_found')
  }

  const messages: MessageSummary[] = []
  try {
    const imap = await context.env.DB.prepare(
      `SELECT * FROM imap_messages
       WHERE account_id = ? AND thread_key = ? AND folder <> 'draft'
       ORDER BY sent_at ASC`,
    )
      .bind(account.id, threadKey)
      .all<ImapMessageRow>()
    messages.push(...imap.results.map((row) => imapMessageSummary(row, account)))

    const relay = await context.env.DB.prepare(
      `SELECT * FROM messages
       WHERE account_id = ? AND thread_key = ? AND folder <> 'draft'
       ORDER BY sent_at ASC`,
    )
      .bind(account.id, threadKey)
      .all<MessageRow>()
    messages.push(...relay.results.map((row) => relayMessageSummary(row, account)))
  } catch (error) {
    if (isSchemaError(error)) {
      return fail(
        'Run the database migration for conversation grouping',
        503,
        undefined,
        'schema_outdated',
      )
    }
    throw error
  }

  messages.sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())

  try {
    const ids = messages.map((message) => message.id)
    for (let index = 0; index < ids.length; index += 50) {
      const chunk = ids.slice(index, index + 50)
      const placeholders = chunk.map(() => '?').join(', ')
      const rows = await context.env.DB.prepare(
        `SELECT message_id, label_id FROM message_labels WHERE message_id IN (${placeholders})`,
      )
        .bind(...chunk)
        .all<{ message_id: string; label_id: string }>()
      for (const row of rows.results) {
        const message = messages.find((item) => item.id === row.message_id)
        if (message) {
          message.labelIds = [...message.labelIds, row.label_id]
        }
      }
    }
  } catch (error) {
    if (!isSchemaError(error)) {
      throw error
    }
  }

  return json({ messages })
}
