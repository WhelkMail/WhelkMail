import { listAccountRows } from '../../../functions/_lib/db'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { withImap } from '../../_lib/mail/imap'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'
import { mergeThreadsBySubject } from '../../_lib/mail/thread-key'
import { backfillThreadKeys, SYNC_FOLDERS } from '../../_lib/sync'

/** Messages whose key is read per call, across all folders of one account. */
const BUDGET = 200
const BATCH = 50

interface AccountThreadStats {
  accountId: string
  email: string
  pending: number
  messages: number
  threads: number
}

async function pendingByAccount(env: Env): Promise<AccountThreadStats[]> {
  const accounts = (await listAccountRows(env)).filter((row) => row.kind === 'imap')
  const counts = new Map<string, { pending: number; messages: number; threads: number }>()
  try {
    const rows = await env.DB.prepare(
      `SELECT account_id,
              COUNT(*) AS messages,
              COUNT(DISTINCT COALESCE(thread_key, stable_key)) AS threads,
              SUM(CASE WHEN thread_key IS NULL THEN 1 ELSE 0 END) AS pending
       FROM imap_messages GROUP BY account_id`,
    ).all<{ account_id: string; messages: number; threads: number; pending: number }>()
    for (const row of rows.results) {
      counts.set(row.account_id, {
        pending: row.pending ?? 0,
        messages: row.messages ?? 0,
        threads: row.threads ?? 0,
      })
    }
  } catch (error) {
    if (isSchemaError(error)) {
      return []
    }
    throw error
  }
  return accounts.map((account) => {
    const stats = counts.get(account.id) ?? { pending: 0, messages: 0, threads: 0 }
    return {
      accountId: account.id,
      email: account.email,
      pending: stats.pending,
      messages: stats.messages,
      threads: stats.threads,
    }
  })
}

/** Collapse conversations that differ only by a Re:/Fwd: prefix. */
async function mergeBySubject(env: Env, accountId: string): Promise<number> {
  const rows = await env.DB.prepare(
    'SELECT id, subject, thread_key, sent_at FROM imap_messages WHERE account_id = ? ORDER BY sent_at DESC LIMIT 5000',
  )
    .bind(accountId)
    .all<{ id: string; subject: string | null; thread_key: string | null; sent_at: string }>()
  const updates = mergeThreadsBySubject(
    rows.results.map((row) => ({
      id: row.id,
      subject: row.subject,
      threadKey: row.thread_key,
      sentAt: row.sent_at,
    })),
  )
  if (updates.size === 0) {
    return 0
  }
  await env.DB.batch(
    [...updates].map(([id, key]) =>
      env.DB.prepare('UPDATE imap_messages SET thread_key = ? WHERE id = ?').bind(key, id),
    ),
  )
  return updates.size
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    return json({ accounts: await pendingByAccount(context.env) })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

/**
 * Place the mail mirrored before threading existed into its conversation.
 *
 * Only headers are fetched (`UID FETCH ... HEADER.FIELDS`), never bodies, and the
 * work is bounded per call so the Worker stays inside its budget: the button can
 * be pressed again until nothing is pending.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await readJson<{ accountId?: string }>(context.request ?? new Request('http://x'))
    const accountId = body?.accountId
    if (!accountId) {
      return fail('accountId is required', 400, undefined, 'thread_rebuild_invalid')
    }
    const account = (await listAccountRows(context.env)).find((row) => row.id === accountId)
    if (!account || account.kind !== 'imap') {
      return fail('Account not found', 404, undefined, 'account_not_found')
    }

    let updated = 0
    for (const folder of SYNC_FOLDERS) {
      if (updated >= BUDGET) {
        break
      }
      try {
        await withImap(context.env, account, async (connection) => {
          while (updated < BUDGET) {
            const count = await backfillThreadKeys(
              context.env,
              connection,
              account,
              folder,
              Math.min(BATCH, BUDGET - updated),
            )
            if (count === 0) {
              break
            }
            updated += count
          }
        })
      } catch {
        // A folder that fails (missing on the server, offline) is skipped.
      }
    }

    // Rows already mirrored keep no threading headers, but their subject is
    // enough to put a reply back where it belongs.
    const merged = await mergeBySubject(context.env, accountId)
    const pending = await pendingByAccount(context.env)
    return json({
      updated,
      merged,
      pending: pending.find((entry) => entry.accountId === accountId)?.pending ?? 0,
    })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}
