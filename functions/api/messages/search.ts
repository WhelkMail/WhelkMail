import type { Folder, MessageSummary } from '../../../shared/types'
import {
  getAccountRow,
  listAccountRows,
  relayMessageSummary,
  type AccountRow,
  type MessageRow,
} from '../../_lib/db'
import { toContact, type ContactRow } from '../../_lib/contacts'
import type { Env } from '../../_lib/env'
import { fail, json } from '../../_lib/http'
import { isSchemaError } from '../../_lib/schema'
import { imapMessageSummary, type ImapMessageRow } from '../../_lib/sync'

const MAX_RESULTS = 100
const MAX_CONTACTS = 20

function likeNeedle(query: string): string {
  return `%${query.toLowerCase().replace(/[%_]/g, ' ')}%`
}

function parseFolder(value: string | null): Folder | null {
  return value === 'inbox' || value === 'sent' || value === 'draft' || value === 'spam'
    ? value
    : null
}

async function searchLabels(env: Env, messages: MessageSummary[]): Promise<void> {
  if (messages.length === 0) {
    return
  }
  try {
    const ids = [...new Set(messages.map((message) => message.id))]
    const assignments = new Map<string, string[]>()
    for (let index = 0; index < ids.length; index += 50) {
      const chunk = ids.slice(index, index + 50)
      const placeholders = chunk.map(() => '?').join(', ')
      const result = await env.DB.prepare(
        `SELECT message_id, label_id FROM message_labels WHERE message_id IN (${placeholders})`,
      )
        .bind(...chunk)
        .all<{ message_id: string; label_id: string }>()
      for (const row of result.results) {
        const current = assignments.get(row.message_id) ?? []
        current.push(row.label_id)
        assignments.set(row.message_id, current)
      }
    }
    for (const message of messages) {
      message.labelIds = assignments.get(message.id) ?? []
    }
  } catch (error) {
    if (!isSchemaError(error)) {
      throw error
    }
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const query = (url.searchParams.get('q') ?? '').trim()
  if (!query) {
    return json({ messages: [], contacts: [], errors: [] })
  }
  if (query.length > 200) {
    return fail('Search query is too long', 400, undefined, 'invalid_request')
  }

  const accountId = url.searchParams.get('accountId') ?? 'all'
  const folder = parseFolder(url.searchParams.get('folder'))
  const includeContacts = url.searchParams.get('contacts') !== '0'

  let accounts: AccountRow[]
  if (accountId === 'all') {
    accounts = await listAccountRows(context.env)
  } else {
    const row = await getAccountRow(context.env, accountId)
    if (!row) {
      return fail('Account not found', 404, undefined, 'account_not_found')
    }
    accounts = [row]
  }
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const accountIds = accounts.map((account) => account.id)
  const needle = likeNeedle(query)
  const messages: MessageSummary[] = []

  if (accountIds.length > 0) {
    const placeholders = accountIds.map(() => '?').join(', ')
    const folderClause = folder ? ' AND folder = ?' : ''
    const imapParams: (string | number)[] = [...Array(6).fill(needle), ...accountIds]
    if (folder) {
      imapParams.push(folder)
    }
    try {
      const rows = await context.env.DB.prepare(
        `SELECT * FROM imap_messages WHERE (lower(subject) LIKE ? OR lower(snippet) LIKE ? OR lower(from_email) LIKE ? OR lower(ifnull(from_name, '')) LIKE ? OR lower(to_json) LIKE ? OR lower(cc_json) LIKE ?) AND account_id IN (${placeholders})${folderClause} ORDER BY sent_at DESC LIMIT ?`,
      )
        .bind(...imapParams, MAX_RESULTS)
        .all<ImapMessageRow>()
      for (const row of rows.results) {
        const account = byId.get(row.account_id)
        if (account) {
          messages.push(imapMessageSummary(row, account))
        }
      }
    } catch (error) {
      if (!isSchemaError(error)) {
        throw error
      }
    }

    const relayClause = folder ? ' AND folder = ?' : ''
    const relayParams: (string | number)[] = [...Array(7).fill(needle), ...accountIds]
    if (folder) {
      relayParams.push(folder)
    }
    try {
      const rows = await context.env.DB.prepare(
        `SELECT * FROM messages WHERE (lower(subject) LIKE ? OR lower(snippet) LIKE ? OR lower(body_text) LIKE ? OR lower(from_email) LIKE ? OR lower(ifnull(from_name, '')) LIKE ? OR lower(to_json) LIKE ? OR lower(cc_json) LIKE ?) AND account_id IN (${placeholders})${relayClause} ORDER BY sent_at DESC LIMIT ?`,
      )
        .bind(...relayParams, MAX_RESULTS)
        .all<MessageRow>()
      for (const row of rows.results) {
        const account = byId.get(row.account_id)
        if (account) {
          messages.push(relayMessageSummary(row, account))
        }
      }
    } catch (error) {
      if (!isSchemaError(error)) {
        throw error
      }
    }
  }

  messages.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
  const limited = messages.slice(0, MAX_RESULTS)
  await searchLabels(context.env, limited)

  let contacts: ReturnType<typeof toContact>[] = []
  if (includeContacts) {
    try {
      const rows = await context.env.DB.prepare(
        'SELECT * FROM contacts WHERE lower(name) LIKE ? OR lower(email) LIKE ? ORDER BY name COLLATE NOCASE ASC LIMIT ?',
      )
        .bind(needle, needle, MAX_CONTACTS)
        .all<ContactRow>()
      contacts = rows.results.map(toContact)
    } catch (error) {
      if (!isSchemaError(error)) {
        throw error
      }
    }
  }

  return json({ messages: limited, contacts, errors: [] })
}
