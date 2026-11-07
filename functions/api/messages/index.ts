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
import { prefetchMessageBodies } from '../../_lib/mail/prefetch'
import { imapMessageId, parseImapMessageId, parseRelayMessageId } from '../../_lib/mail/ids'
import { dateOf, parseHeaders, toMailbox, toMailboxes } from '../../_lib/mail/parse'
import { isSchemaError } from '../../_lib/schema'
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
): Promise<MessageSummary[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM messages WHERE account_id = ? AND folder = ? ORDER BY sent_at DESC LIMIT 30',
  )
    .bind(account.id, folder)
    .all<MessageRow>()
  return result.results.map((row) => relayMessageSummary(row, account))
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
): Promise<MessageSummary[]> {
  if (accounts.length === 0) {
    return []
  }
  const placeholders = accounts.map(() => '?').join(', ')
  const rows = await env.DB.prepare(
    `SELECT m.* FROM imap_messages m JOIN message_labels ml ON ml.message_id = m.id WHERE ml.label_id = ? AND m.account_id IN (${placeholders}) ORDER BY m.sent_at DESC LIMIT 100`,
  )
    .bind(labelId, ...accounts.map((account) => account.id))
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
): Promise<{ messages: MessageSummary[]; errors: AccountError[] }> {
  try {
    const mirrored = await loadMirrorByLabel(env, accounts, labelId)
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

const SYNC_TTL_MS = 60_000
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
    const { messages, errors } = await loadByLabel(context.env, accounts, labelId)
    messages.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    return json({ messages: messages.slice(0, 100), errors })
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
      if (account.kind === 'imap') {
        let mirrored: MessageSummary[] = []
        let syncState: MailboxSyncState | null = null
        const mirrorStartedAt = Date.now()
        try {
          mirrored = await listMirrorMessages(context.env, account, folder)
          syncState = await getSyncState(context.env, account.id, folder)
        } catch (error) {
          if (!isSchemaError(error)) {
            throw error
          }
        }
        mirrorMs = Date.now() - mirrorStartedAt

        if (mirrored.length > 0) {
          loaded = mirrored
          needSync = needsBackgroundSync(syncState)
        } else if (syncState && syncState.status === 'done' && syncState.synced === 0) {
          loaded = []
          needSync = needsBackgroundSync(syncState)
        } else {
          // Bootstrap the D1 mirror with a single blocking sync chunk instead
          // of opening a second IMAP connection for a separate live read.
          const bootstrapStartedAt = Date.now()
          try {
            const result = await runSyncChunk(context.env, account, folder)
            const rereadStartedAt = Date.now()
            mirrored = await listMirrorMessages(context.env, account, folder)
            mirrorMs += Date.now() - rereadStartedAt
            needSync = false
            if (result.hasMore) {
              syncing = true
            }
            if (mirrored.length === 0) {
              // Another worker may have held the lock, or the mailbox may be
              // empty. Only read from IMAP if the folder has not completed a sync.
              const stateAfter = await getSyncState(context.env, account.id, folder)
              loaded =
                stateAfter?.status === 'done'
                  ? []
                  : await summariesFromImap(context.env, account, folder)
              if (stateAfter?.status === 'partial') {
                syncing = true
              }
            } else {
              loaded = mirrored
            }
          } catch (error) {
            await markSyncError(
              context.env,
              account.id,
              folder,
              error instanceof Error ? error.message : String(error),
            ).catch(() => undefined)
            loaded = await summariesFromImap(context.env, account, folder)
            needSync = false
          }
          liveMs = Date.now() - bootstrapStartedAt
        }

        if (syncState?.status === 'partial') {
          syncing = true
        }

        if (needSync) {
          syncing = true
          context.waitUntil(runBackgroundSync(context.env, account, folder))
        }
      } else {
        loaded = await summariesFromRelay(context.env, account, folder)
      }

      await applyLabels(context.env, loaded)
      await applyFilters(context.env, account.id, loaded)
      await applyAccountLabel(context.env, account.id, account.incoming_label_id, loaded)
      messages.push(...loaded)
      if (
        account.kind === 'imap' &&
        loaded.length > 0 &&
        (accountId !== 'all' || account.id === accounts[0]?.id)
      ) {
        const maxPrefetch = accountId === 'all' ? 1 : 3
        const prefetchIds = [...loaded]
          .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
          .slice(0, maxPrefetch)
          .map((message) => message.id)
        if (prefetchIds.length > 0) {
          context.waitUntil(
            prefetchMessageBodies(
              context.env,
              account,
              folder,
              prefetchIds,
              prefetchIds.length,
            ).catch(() => undefined),
          )
        }
      }
      console.log(
        `[messages] ${account.id}/${folder} mirror=${mirrorMs}ms live=${liveMs}ms labels=${Date.now() - accountStartedAt - mirrorMs - liveMs}ms sync=${needSync}`,
      )
    } catch (error) {
      errors.push({
        accountId: account.id,
        email: account.email,
        message: error instanceof Error ? error.message : 'Errore IMAP',
      })
    }
  }

  messages.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
  return json({ messages: messages.slice(0, 100), errors, syncing })
}
