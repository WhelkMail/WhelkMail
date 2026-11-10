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
import {
  clampPageSize,
  decodePageCursor,
  pageOf,
  type PageCursor,
} from '../../../shared/paging'

const MAX_CONTACTS = 20

function likeNeedle(query: string): string {
  return `%${query.toLowerCase().replace(/[%_]/g, ' ')}%`
}

function parseFolder(value: string | null): Folder | null {
  return value === 'inbox' || value === 'sent' || value === 'draft' || value === 'spam'
    ? value
    : null
}

function pageClause(before: PageCursor | null): string {
  return before ? ' AND (sent_at < ? OR (sent_at = ? AND id < ?))' : ''
}

function pageParams(before: PageCursor | null): (string | number)[] {
  return before ? [before.date, before.date, before.id] : []
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
  const before = decodePageCursor(url.searchParams.get('before'))
  const limit = clampPageSize(Number(url.searchParams.get('limit') ?? ''))
  if (!query) {
    return json({ messages: [], contacts: [], errors: [], nextCursor: null })
  }
  if (query.length > 200) {
    return fail('Search query is too long', 400, undefined, 'invalid_request')
  }

  const accountId = url.searchParams.get('accountId') ?? 'all'
  const folder = parseFolder(url.searchParams.get('folder'))
  const includeContacts = url.searchParams.get('contacts') !== '0' && !before

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
    const imapParams: (string | number)[] = [...Array(7).fill(needle), ...accountIds]
    if (folder) {
      imapParams.push(folder)
    }
    imapParams.push(...pageParams(before), limit)
    try {
      const rows = await context.env.DB.prepare(
        `SELECT * FROM imap_messages WHERE (lower(subject) LIKE ? OR lower(snippet) LIKE ? OR lower(search_text) LIKE ? OR lower(from_email) LIKE ? OR lower(ifnull(from_name, '')) LIKE ? OR lower(to_json) LIKE ? OR lower(cc_json) LIKE ?) AND account_id IN (${placeholders})${folderClause}${pageClause(before)} ORDER BY sent_at DESC, id DESC LIMIT ?`,
      )
        .bind(...imapParams)
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
      // Databases created before migration 019 have no search_text column.
      const legacyParams: (string | number)[] = [...Array(6).fill(needle), ...accountIds]
      if (folder) {
        legacyParams.push(folder)
      }
      legacyParams.push(...pageParams(before), limit)
      const rows = await context.env.DB.prepare(
        `SELECT * FROM imap_messages WHERE (lower(subject) LIKE ? OR lower(snippet) LIKE ? OR lower(from_email) LIKE ? OR lower(ifnull(from_name, '')) LIKE ? OR lower(to_json) LIKE ? OR lower(cc_json) LIKE ?) AND account_id IN (${placeholders})${folderClause}${pageClause(before)} ORDER BY sent_at DESC, id DESC LIMIT ?`,
      )
        .bind(...legacyParams)
        .all<ImapMessageRow>()
      for (const row of rows.results) {
        const account = byId.get(row.account_id)
        if (account) {
          messages.push(imapMessageSummary(row, account))
        }
      }
    }

    const relayClause = folder ? ' AND folder = ?' : ''
    const relayParams: (string | number)[] = [...Array(7).fill(needle), ...accountIds]
    if (folder) {
      relayParams.push(folder)
    }
    relayParams.push(...pageParams(before), limit)
    try {
      const rows = await context.env.DB.prepare(
        `SELECT * FROM messages WHERE (lower(subject) LIKE ? OR lower(snippet) LIKE ? OR lower(body_text) LIKE ? OR lower(from_email) LIKE ? OR lower(ifnull(from_name, '')) LIKE ? OR lower(to_json) LIKE ? OR lower(cc_json) LIKE ?) AND account_id IN (${placeholders})${relayClause}${pageClause(before)} ORDER BY sent_at DESC, id DESC LIMIT ?`,
      )
        .bind(...relayParams)
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

  messages.sort(
    (left, right) =>
      new Date(right.date).getTime() - new Date(left.date).getTime() ||
      left.id.localeCompare(right.id),
  )
  const page = pageOf(messages, limit)
  await searchLabels(context.env, page.items)

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

  return json({ messages: page.items, contacts, errors: [], nextCursor: page.nextCursor })
}
