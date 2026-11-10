import type { Folder, Mailbox, MailboxSyncState, MessageSummary } from '../../../shared/types'
import {
  getAccountRow,
  listAccountRows,
  relayMessageSummary,
  type AccountRow,
  type MessageRow,
} from '../../_lib/db'
import type { Env } from '../../_lib/env'
import { fail, json } from '../../_lib/http'
import type { ImapHeader } from '../../_lib/imap/client'
import { applyAccountLabel, applyFilters } from '../../_lib/filters'
import { listFolder, listFolderByUids } from '../../_lib/mail/imap'
import { imapMessageId, parseImapMessageId, parseRelayMessageId } from '../../_lib/mail/ids'
import { dateOf, parseHeaders, toMailbox, toMailboxes } from '../../_lib/mail/parse'
import { isSchemaError } from '../../_lib/schema'
import {
  clampPageSize,
  decodePageCursor,
  pageOf,
  type PageCursor,
} from '../../../shared/paging'
import {
  getSyncState,
  imapMessageSummary,
  listMirrorMessages,
  markSyncError,
  runSyncChunk,
  type ImapMessageRow,
} from '../../_lib/sync'

interface AccountError {
  accountId: string
  email: string
  message: string
}

interface LabelAssignment {
  message_id: string
  account_id: string
  folder: string
}

async function summariesFromHeaders(
  account: AccountRow,
  folder: Folder,
  headers: ImapHeader[],
): Promise<MessageSummary[]> {
  const summaries: MessageSummary[] = []
  for (const header of headers) {
    const email = await parseHeaders(header.header)
    const from: Mailbox = email.from ? toMailbox(email.from) : { name: null, email: '' }
    summaries.push({
      id: imapMessageId(account.id, folder, header.uid),
      accountId: account.id,
      accountEmail: account.email,
      accountName: account.display_name,
      folder,
      from,
      to: toMailboxes(email.to),
      cc: toMailboxes(email.cc),
      bcc: toMailboxes(email.bcc),
      subject: email.subject ?? '',
      snippet: '',
      date: dateOf(email),
      unread:
        folder === 'draft' ? false : !header.flags.some((flag) => flag.toLowerCase() === '\\seen'),
      hasAttachments: header.hasAttachments,
      status: folder === 'draft' ? 'draft' : 'sent',
      labelIds: [],
    })
  }
  return summaries
}

async function summariesFromImap(
  env: Env,
  account: AccountRow,
  folder: Folder,
): Promise<MessageSummary[]> {
  const headers = await listFolder(env, account, folder, 30)
  return summariesFromHeaders(account, folder, headers)
}

async function applyLabels(env: Env, messages: MessageSummary[]): Promise<void> {
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
    if (isSchemaError(error)) {
      for (const message of messages) {
        message.labelIds = []
      }
      return
    }
    throw error
  }
}

async function summariesFromRelay(
  env: Env,
  account: AccountRow,
  folder: Folder,
  limit: number,
  before: PageCursor | null,
): Promise<MessageSummary[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM messages WHERE account_id = ? AND folder = ?${pageClause(before)} ORDER BY sent_at DESC, id DESC LIMIT ?`,
  )
    .bind(account.id, folder, ...pageParams(before), limit)
    .all<MessageRow>()
  return result.results.map((row) => relayMessageSummary(row, account))
}

function pageClause(before: PageCursor | null): string {
  return before ? ' AND (sent_at < ? OR (sent_at = ? AND id < ?))' : ''
}

function pageParams(before: PageCursor | null): string[] {
  return before ? [before.date, before.date, before.id] : []
}

async function summariesFromImapLabel(
  env: Env,
  account: AccountRow,
  assignments: LabelAssignment[],
): Promise<MessageSummary[]> {
  const byFolder = new Map<Folder, number[]>()
  for (const assignment of assignments) {
    const parsed = parseImapMessageId(assignment.message_id)
    if (!parsed || parsed.accountId !== account.id) {
      continue
    }
    const uids = byFolder.get(parsed.folder) ?? []
    uids.push(parsed.uid)
    byFolder.set(parsed.folder, uids)
  }
  const summaries: MessageSummary[] = []
  for (const [folder, uids] of byFolder) {
    const headers = await listFolderByUids(env, account, folder, [...new Set(uids)])
    summaries.push(...(await summariesFromHeaders(account, folder, headers)))
  }
  return summaries
}

async function summariesFromRelayLabel(
  env: Env,
  account: AccountRow,
  assignments: LabelAssignment[],
): Promise<MessageSummary[]> {
  const ids = [
    ...new Set(
      assignments
        .map((assignment) => parseRelayMessageId(assignment.message_id))
        .filter((value): value is string => Boolean(value)),
    ),
  ]
  const rows: MessageRow[] = []
  for (let index = 0; index < ids.length; index += 50) {
    const chunk = ids.slice(index, index + 50)
    const placeholders = chunk.map(() => '?').join(', ')
    const result = await env.DB.prepare(
      `SELECT * FROM messages WHERE id IN (${placeholders})`,
    )
      .bind(...chunk)
      .all<MessageRow>()
    rows.push(...result.results)
  }
  return rows.map((row) => relayMessageSummary(row, account))
}

async function loadMirrorByLabel(
  env: Env,
  accounts: AccountRow[],
  labelId: string,
  limit: number,
  before: PageCursor | null,
): Promise<MessageSummary[]> {
  if (accounts.length === 0) {
    return []
  }
  const placeholders = accounts.map(() => '?').join(', ')
  const rows = await env.DB.prepare(
    `SELECT m.* FROM imap_messages m JOIN message_labels ml ON ml.message_id = m.id WHERE ml.label_id = ? AND m.account_id IN (${placeholders})${before ? ' AND (m.sent_at < ? OR (m.sent_at = ? AND m.id < ?))' : ''} ORDER BY m.sent_at DESC, m.id DESC LIMIT ?`,
  )
    .bind(
      labelId,
      ...accounts.map((account) => account.id),
      ...(before ? [before.date, before.date, before.id] : []),
      limit,
    )
    .all<ImapMessageRow>()
  const byId = new Map(accounts.map((account) => [account.id, account]))
  return rows.results
    .map((row) => {
      const account = byId.get(row.account_id)
      return account ? imapMessageSummary(row, account) : null
    })
    .filter((message): message is MessageSummary => Boolean(message))
}

async function loadByLabel(
  env: Env,
  accounts: AccountRow[],
  labelId: string,
  limit: number,
  before: PageCursor | null,
): Promise<{ messages: MessageSummary[]; errors: AccountError[] }> {
  try {
    const mirrored = await loadMirrorByLabel(env, accounts, labelId, limit, before)
    if (mirrored.length > 0) {
      const groups = new Map<string, MessageSummary[]>()
      for (const message of mirrored) {
        const key = `${message.accountId}|${message.folder}`
        const current = groups.get(key) ?? []
        current.push(message)
        groups.set(key, current)
      }
      for (const group of groups.values()) {
        await applyLabels(env, group)
      }
      return { messages: mirrored, errors: [] }
    }
  } catch (error) {
    if (!isSchemaError(error)) {
      throw error
    }
  }

  const result = await env.DB.prepare(
    'SELECT message_id, account_id, folder FROM message_labels WHERE label_id = ?',
  )
    .bind(labelId)
    .all<LabelAssignment>()
  const byAccount = new Map<string, LabelAssignment[]>()
  for (const assignment of result.results) {
    const current = byAccount.get(assignment.account_id) ?? []
    current.push(assignment)
    byAccount.set(assignment.account_id, current)
  }

  const messages: MessageSummary[] = []
  const errors: AccountError[] = []
  for (const account of accounts) {
    const assignments = byAccount.get(account.id)
    if (!assignments || assignments.length === 0) {
      continue
    }
    if (account.kind === 'imap' && !account.secret_enc) {
      continue
    }
    try {
      const loaded =
        account.kind === 'imap'
          ? await summariesFromImapLabel(env, account, assignments)
          : await summariesFromRelayLabel(env, account, assignments)
      const folders = new Set(loaded.map((message) => message.folder))
      for (const folder of folders) {
        await applyLabels(
          env,
          loaded.filter((message) => message.folder === folder),
        )
      }
      messages.push(...loaded)
    } catch (error) {
      errors.push({
        accountId: account.id,
        email: account.email,
        message: error instanceof Error ? error.message : 'Errore IMAP',
      })
    }
  }
  return { messages, errors }
}

const SYNC_TTL_MS = 5 * 60_000
const BACKFILL_RETRY_MS = 8_000
const syncInFlight = new Set<string>()

function needsBackgroundSync(state: MailboxSyncState | null): boolean {
  if (!state?.lastSyncedAt) {
    return true
  }
  const lastSyncedAt = Date.parse(state.lastSyncedAt)
  if (!Number.isFinite(lastSyncedAt)) {
    return true
  }
  const age = Date.now() - lastSyncedAt
  if (state.status === 'partial') {
    return age > BACKFILL_RETRY_MS
  }
  return age > SYNC_TTL_MS
}

async function runBackgroundSync(
  env: Env,
  account: AccountRow,
  folder: Folder,
): Promise<void> {
  const key = `${account.id}:${folder}`
  if (syncInFlight.has(key)) {
    return
  }
  syncInFlight.add(key)
  try {
    await runSyncChunk(env, account, folder)
  } catch (error) {
    await markSyncError(
      env,
      account.id,
      folder,
      error instanceof Error ? error.message : String(error),
    ).catch(() => undefined)
  } finally {
    syncInFlight.delete(key)
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const accountId = url.searchParams.get('accountId') ?? 'all'
  const folderParam = url.searchParams.get('folder')
  const labelId = url.searchParams.get('labelId')
  const before = decodePageCursor(url.searchParams.get('before'))
  const limit = clampPageSize(Number(url.searchParams.get('limit') ?? ''))
  const folder: Folder =
    folderParam === 'sent'
      ? 'sent'
      : folderParam === 'draft'
        ? 'draft'
        : folderParam === 'spam'
          ? 'spam'
          : 'inbox'

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

  if (labelId) {
    const { messages, errors } = await loadByLabel(context.env, accounts, labelId, limit, before)
    messages.sort(
      (left, right) =>
        new Date(right.date).getTime() - new Date(left.date).getTime() ||
        left.id.localeCompare(right.id),
    )
    const page = pageOf(messages, limit)
    return json({ messages: page.items, errors, nextCursor: page.nextCursor })
  }

  const messages: MessageSummary[] = []
  const errors: AccountError[] = []
  let syncing = false

  for (const account of accounts) {
    if (account.kind === 'imap' && !account.secret_enc) {
      continue
    }
    if (account.kind === 'relay' && folder === 'inbox') {
      continue
    }
    const accountStartedAt = Date.now()
    let mirrorMs = 0
    let liveMs = 0
    try {
      let loaded: MessageSummary[]
      let needSync = false
      let syncState: MailboxSyncState | null = null
      if (account.kind === 'imap') {
        let mirrored: MessageSummary[] = []
        const mirrorStartedAt = Date.now()
        try {
          mirrored = await listMirrorMessages(context.env, account, folder, limit, before)
          syncState = await getSyncState(context.env, account.id, folder)
        } catch (error) {
          if (!isSchemaError(error)) {
            throw error
          }
        }
        mirrorMs = Date.now() - mirrorStartedAt

        if (!syncState && mirrored.length === 0) {
          // First visit to this folder: bootstrap a single sync chunk so the
          // list is not empty on the very first open. This only happens once.
          const bootstrapStartedAt = Date.now()
          try {
            const result = await runSyncChunk(context.env, account, folder)
            const rereadStartedAt = Date.now()
            mirrored = await listMirrorMessages(context.env, account, folder, limit, before)
            mirrorMs += Date.now() - rereadStartedAt
            loaded =
              mirrored.length > 0
                ? mirrored
                : await summariesFromImap(context.env, account, folder)
            syncing = result.hasMore
          } catch (error) {
            await markSyncError(
              context.env,
              account.id,
              folder,
              error instanceof Error ? error.message : String(error),
            ).catch(() => undefined)
            loaded = await summariesFromImap(context.env, account, folder)
          }
          liveMs = Date.now() - bootstrapStartedAt
        } else {
          // Fast path: serve the D1 mirror and never block the request on IMAP.
          // The sync runs in the background and the client polls while syncing.
          loaded = mirrored
          needSync = needsBackgroundSync(syncState)
          if (needSync || syncState?.status === 'partial') {
            syncing = true
            context.waitUntil(runBackgroundSync(context.env, account, folder))
          }
          if (loaded.length === 0 && syncState?.error) {
            errors.push({
              accountId: account.id,
              email: account.email,
              message: syncState.error,
            })
          }
        }
      } else {
        loaded = await summariesFromRelay(context.env, account, folder, limit, before)
      }

      await applyLabels(context.env, loaded)
      await applyFilters(context.env, account.id, loaded)
      await applyAccountLabel(context.env, account.id, account.incoming_label_id, loaded)
      messages.push(...loaded)
      console.log(
        `[messages] ${account.id}/${folder} mirror=${mirrorMs}ms live=${liveMs}ms labels=${Date.now() - accountStartedAt - mirrorMs - liveMs}ms sync=${needSync || syncState?.status === 'partial'}`,
      )
    } catch (error) {
      errors.push({
        accountId: account.id,
        email: account.email,
        message: error instanceof Error ? error.message : 'Errore IMAP',
      })
    }
  }

  messages.sort(
    (left, right) =>
      new Date(right.date).getTime() - new Date(left.date).getTime() ||
      left.id.localeCompare(right.id),
  )
  const page = pageOf(messages, limit)
  return json({ messages: page.items, errors, syncing, nextCursor: page.nextCursor })
}
