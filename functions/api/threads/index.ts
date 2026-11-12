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
import { needsBackgroundSync } from '../../_lib/sync-trigger'
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

  // Every conversation on the page is loaded: the cap is per thread (how much of
  // its history is used for participants), never global, so a busy conversation
  // cannot push another one out of the page.
  const keys = [...new Set(groups.map((group) => group.key))]
  if (keys.length === 0) {
    return { groups: [], threads }
  }
  const placeholders = keys.map(() => '?').join(', ')
  const PER_THREAD = 40
  const imapKey = 'COALESCE(thread_key, stable_key)'
  const relayKey = "COALESCE(thread_key, 'r:' || id)"

  const [imapMessages, relayMessages, imapCounts, relayCounts] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY ${imapKey} ORDER BY sent_at DESC) AS rn
         FROM imap_messages
         WHERE account_id = ? AND folder <> 'draft' AND ${imapKey} IN (${placeholders})
       ) WHERE rn <= ? ORDER BY sent_at ASC`,
    )
      .bind(account.id, ...keys, PER_THREAD)
      .all<ImapMessageRow & { rn: number }>(),
    env.DB.prepare(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY ${relayKey} ORDER BY sent_at DESC) AS rn
         FROM messages
         WHERE account_id = ? AND folder <> 'draft' AND ${relayKey} IN (${placeholders})
       ) WHERE rn <= ? ORDER BY sent_at ASC`,
    )
      .bind(account.id, ...keys, PER_THREAD)
      .all<MessageRow & { rn: number }>(),
    env.DB.prepare(
      `SELECT ${imapKey} AS key, COUNT(*) AS total, COALESCE(SUM(unread), 0) AS unread
       FROM imap_messages
       WHERE account_id = ? AND folder <> 'draft' AND ${imapKey} IN (${placeholders})
       GROUP BY key`,
    )
      .bind(account.id, ...keys)
      .all<{ key: string; total: number; unread: number }>(),
    env.DB.prepare(
      `SELECT ${relayKey} AS key, COUNT(*) AS total, 0 AS unread
       FROM messages
       WHERE account_id = ? AND folder <> 'draft' AND ${relayKey} IN (${placeholders})
       GROUP BY key`,
    )
      .bind(account.id, ...keys)
      .all<{ key: string; total: number; unread: number }>(),
  ])

  for (const row of imapMessages.results) {
    addThreadRow(threads, row.thread_key ?? row.stable_key, row, row.from_name, row.from_email, Boolean(row.unread))
  }
  for (const row of relayMessages.results) {
    addThreadRow(threads, row.thread_key ?? `r:${row.id}`, row, row.from_name, row.from_email, false)
  }
  // Totals come from the whole conversation, independently of how much of it was
  // loaded above.
  for (const row of [...imapCounts.results, ...relayCounts.results]) {
    const entry = threads.get(row.key)
    if (entry) {
      entry.messages = row.total
      entry.unread = row.unread
    }
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
    threads.get(key) ?? { latest: row, participants: [], participantCount: 0, messages: 0, unread: unread ? 1 : 0 }
  entry.latest = row
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
        let accountSyncing = false
        let accountStale = false
        if (scope.kind === 'folder') {
          const state = await getSyncState(context.env, account.id, scope.folder)
          accountSyncing = state?.status === 'partial'
          accountStale = needsBackgroundSync(state)
        }
        const loaded = await accountThreads(context.env, account, scope, limit, before)
        return {
          account,
          loaded,
          syncing: accountSyncing,
          stale: accountStale,
          error: null as string | null,
        }
      } catch (error) {
        if (isSchemaError(error)) {
          throw error
        }
        return {
          account,
          loaded: null,
          syncing: false,
          stale: false,
          error: error instanceof Error ? error.message : 'Errore',
        }
      }
    }),
  )

  // Each account reports its own state: a shared variable let the last account
  // overwrite the others, so a running sync could look finished.
  syncing = perAccount.some((result) => result.syncing)
  // Folders whose mirror is old. The browser asks for a sync *after* the list is
  // on screen: doing that here kept the response waiting behind IMAP work.
  const staleAccounts = scope.kind === 'folder'
    ? perAccount.filter((result) => result.stale).map((result) => result.account.id)
    : []

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
          lastAt: group.last_at,
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

  // Same pair as the SQL ORDER BY (last_at DESC, key DESC) and as the cursor,
  // otherwise conversations sharing a timestamp could repeat or vanish between
  // pages.
  threads.sort((left, right) =>
    compareByDateDesc({ date: left.lastAt, id: left.threadKey }, { date: right.lastAt, id: right.threadKey }),
  )
  const page = threads.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor =
    threads.length > limit && last
      ? encodePageCursor({ date: last.lastAt, id: last.threadKey })
      : null

  console.log(
    `[threads] accounts=${accounts.length} folder=${labelId ? 'label' : folder} rows=${threads.length} page=${page.length} ms=${Date.now() - startedAt}`,
  )
  return json({ threads: page, errors, syncing, staleAccounts, nextCursor })
}
