import type { Folder, MailThread } from '../../../shared/types'
import {
  getAccountRow,
  listAccountRows,
  relayMessageSummary,
  type AccountRow,
  type MessageRow,
} from '../../_lib/db'
import type { Env } from '../../_lib/env'
import { fail, json } from '../../_lib/http'
import { isSchemaError } from '../../_lib/schema'
import { getSyncState, imapMessageSummary, type ImapMessageRow } from '../../_lib/sync'
import {
  clampPageSize,
  compareByDateDesc,
  decodePageCursor,
  encodePageCursor,
} from '../../../shared/paging'

const THREAD_FOLDERS: Folder[] = ['inbox', 'sent', 'draft', 'spam']

interface GroupRow {
  key: string
  last_at: string
  total: number
  unread: number
}

function parseFolder(value: string | null): Folder {
  if (value === 'sent' || value === 'draft' || value === 'spam') {
    return value
  }
  return 'inbox'
}

/**
 * Page of conversations for one account and folder.
 *
 * Threads are per account and the cursor is `(last message date, thread key)`,
 * mirroring the keyset used by the flat list. Messages mirrored before threading
 * existed have no key yet and use their `stable_key`, so nothing disappears while
 * the backfill catches up.
 */
interface ThreadRows {
  latest: MessageRow | ImapMessageRow
  /** Distinct senders in order of appearance (oldest first, like Gmail). */
  participants: { name: string | null; email: string }[]
  participantCount: number
  messages: number
  unread: number
}

/** What the page is scoped to: one folder, or the messages carrying a label. */
type ThreadScope =
  | { kind: 'folder'; folder: Folder }
  | { kind: 'label'; labelId: string }

async function accountThreads(
  env: Env,
  account: AccountRow,
  scope: ThreadScope,
  limit: number,
  before: { date: string; id: string } | null,
): Promise<{ groups: GroupRow[]; threads: Map<string, ThreadRows> }> {
  const groups: GroupRow[] = []
  const threads = new Map<string, ThreadRows>()

  // The scoped query only decides *which* conversations are on the page and how
  // they are ordered; counts and participants come from the whole thread below.
  const imapWhere =
    scope.kind === 'folder'
      ? 'm.account_id = ? AND m.folder = ?'
      : 'm.account_id = ? AND m.id IN (SELECT message_id FROM message_labels WHERE label_id = ?)'
  const imapParams: string[] = [
    account.id,
    scope.kind === 'folder' ? scope.folder : scope.labelId,
  ]
  const relayWhere =
    scope.kind === 'folder'
      ? 'm.account_id = ? AND m.folder = ?'
      : "m.account_id = ? AND ('r:' || m.id) IN (SELECT message_id FROM message_labels WHERE label_id = ?)"

  const imapSql = `SELECT COALESCE(m.thread_key, m.stable_key) AS key, MAX(m.sent_at) AS last_at, COUNT(*) AS total, COALESCE(SUM(m.unread), 0) AS unread
       FROM imap_messages m WHERE ${imapWhere}
       GROUP BY key${before ? ' HAVING last_at < ? OR (last_at = ? AND key < ?)' : ''}
       ORDER BY last_at DESC, key DESC LIMIT ?`
  const relaySql = `SELECT COALESCE(m.thread_key, 'r:' || m.id) AS key, MAX(m.sent_at) AS last_at, COUNT(*) AS total, 0 AS unread
       FROM messages m WHERE ${relayWhere}
       GROUP BY key${before ? ' HAVING last_at < ? OR (last_at = ? AND key < ?)' : ''}
       ORDER BY last_at DESC, key DESC LIMIT ?`
  // The two scopes (mirrored mail, relay rows) are independent: one round trip
  // instead of two, which matters on a cold Worker with a remote D1.
  const [imapRows, relayRows] = await Promise.all([
    env.DB.prepare(imapSql)
      .bind(...imapParams, ...(before ? [before.date, before.date, before.id] : []), limit)
      .all<GroupRow>(),
    env.DB.prepare(relaySql)
      .bind(...imapParams, ...(before ? [before.date, before.date, before.id] : []), limit)
      .all<GroupRow>(),
  ])
  groups.push(...imapRows.results, ...relayRows.results)

  const keys = [...new Set(groups.map((group) => group.key))].slice(0, 60)
  if (keys.length === 0) {
    return { groups: [], threads }
  }
  const placeholders = keys.map(() => '?').join(', ')
  // The scoped query picks *which* conversations are on the page; the rows are
  // then loaded from every folder of the account (drafts excluded), so a thread
  // you already answered shows the reply too and the count is the real one — the
  // same way Gmail counts the whole conversation in the Inbox.
  const [imapMessages, relayMessages] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM imap_messages WHERE account_id = ? AND folder <> 'draft'
       AND COALESCE(thread_key, stable_key) IN (${placeholders})
     ORDER BY sent_at ASC LIMIT 600`,
    )
      .bind(account.id, ...keys)
      .all<ImapMessageRow>(),
    env.DB.prepare(
      `SELECT * FROM messages WHERE account_id = ? AND folder <> 'draft'
       AND COALESCE(thread_key, 'r:' || id) IN (${placeholders})
     ORDER BY sent_at ASC LIMIT 600`,
    )
      .bind(account.id, ...keys)
      .all<MessageRow>(),
  ])
  for (const row of imapMessages.results) {
    const key = row.thread_key ?? row.stable_key
    addThreadRow(threads, key, row, row.from_name, row.from_email, Boolean(row.unread))
  }

  for (const row of relayMessages.results) {
    const key = row.thread_key ?? `r:${row.id}`
    addThreadRow(threads, key, row, row.from_name, row.from_email, false)
  }

  return { groups, threads }
}

/**
 * Rows arrive oldest first: the last one seen is the newest message, while the
 * participant list keeps the order in which senders first appear in the thread.
 */
function addThreadRow(
  threads: Map<string, ThreadRows>,
  key: string,
  row: MessageRow | ImapMessageRow,
  name: string | null,
  email: string,
  unread: boolean,
): void {
  const entry =
    threads.get(key) ?? { latest: row, participants: [], participantCount: 0, messages: 0, unread: 0 }
  entry.latest = row
  entry.messages += 1
  if (unread) {
    entry.unread += 1
  }
  const known = entry.participants.some(
    (item) => item.email.toLowerCase() === (email ?? '').toLowerCase(),
  )
  if (!known && email) {
    entry.participantCount += 1
    if (entry.participants.length < 6) {
      entry.participants.push({ name: name ?? null, email })
    }
  }
  threads.set(key, entry)
}

async function labelIdsFor(env: Env, ids: string[]): Promise<Map<string, string[]>> {
  const assignments = new Map<string, string[]>()
  if (ids.length === 0) {
    return assignments
  }
  try {
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
  } catch (error) {
    if (!isSchemaError(error)) {
      throw error
    }
  }
  return assignments
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const startedAt = Date.now()
  const url = new URL(context.request.url)
  const accountId = url.searchParams.get('accountId') ?? 'all'
  const labelId = url.searchParams.get('labelId')
  const folder = parseFolder(url.searchParams.get('folder'))
  if (!THREAD_FOLDERS.includes(folder)) {
    return fail('Invalid folder', 400, undefined, 'folder_invalid')
  }
  // A label view is a first-class view: it is grouped by conversation too, and
  // the row shows the whole thread like Gmail does.
  const scope: ThreadScope = labelId ? { kind: 'label', labelId } : { kind: 'folder', folder }
  const limit = clampPageSize(Number(url.searchParams.get('limit') ?? ''))
  const before = decodePageCursor(url.searchParams.get('before'))

  let accounts: AccountRow[]
  if (accountId === 'all') {
    accounts = (await listAccountRows(context.env)).filter(
      (row) => !(row.kind === 'relay' && !labelId && folder === 'inbox'),
    )
  } else {
    const row = await getAccountRow(context.env, accountId)
    if (!row) {
      return fail('Account not found', 404, undefined, 'account_not_found')
    }
    accounts = [row]
  }

  const errors: { accountId: string; email: string; message: string }[] = []
  const threads: MailThread[] = []
  let syncing = false

  // Accounts are independent: query them together instead of one after the other.
  const perAccount = await Promise.all(
    accounts.map(async (account) => {
      try {
        if (scope.kind === 'folder') {
          // Only report: this path never opens an IMAP connection, so opening a
          // folder cannot hang behind a sync. Fetching is left to auto-sync and
          // to the cron worker.
          const state = await getSyncState(context.env, account.id, scope.folder)
          syncing = state?.status === 'partial'
        }
        const loaded = await accountThreads(context.env, account, scope, limit, before)
        return { account, loaded, error: null as string | null }
      } catch (error) {
        if (isSchemaError(error)) {
          throw error
        }
        return {
          account,
          loaded: null,
          error: error instanceof Error ? error.message : 'Errore',
        }
      }
    }),
  )

  for (const result of perAccount) {
    const account = result.account
    if (result.error || !result.loaded) {
      errors.push({
        accountId: account.id,
        email: account.email,
        message: result.error ?? 'Errore',
      })
      continue
    }
    try {
      const { groups, threads: rows } = result.loaded
      for (const group of groups) {
        const entry = rows.get(group.key)
        if (!entry) {
          continue
        }
        const row = entry.latest
        const summary =
          'stable_key' in row
            ? imapMessageSummary(row as ImapMessageRow, account)
            : relayMessageSummary(row as MessageRow, account)
        threads.push({
          threadKey: group.key,
          accountId: account.id,
          accountEmail: account.email,
          accountName: account.display_name,
          folder,
          latest: summary,
          total: entry.messages,
          unread: entry.unread,
          participants: entry.participants,
        })
      }
    } catch (error) {
      if (isSchemaError(error)) {
        return fail(
          'Run the database migration for conversation grouping',
          503,
          undefined,
          'schema_outdated',
        )
      }
      errors.push({
        accountId: account.id,
        email: account.email,
        message: error instanceof Error ? error.message : 'Errore',
      })
    }
  }

  const labels = await labelIdsFor(
    context.env,
    threads.map((thread) => thread.latest.id),
  )
  for (const thread of threads) {
    thread.latest.labelIds = labels.get(thread.latest.id) ?? []
  }

  threads.sort((left, right) => compareByDateDesc(left.latest, right.latest))
  const page = threads.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor =
    threads.length > limit && last
      ? encodePageCursor({ date: last.latest.date, id: last.threadKey })
      : null

  console.log(
    `[threads] accounts=${accounts.length} folder=${labelId ? 'label' : folder} rows=${threads.length} page=${page.length} ms=${Date.now() - startedAt}`,
  )
  return json({ threads: page, errors, syncing, nextCursor })
}
