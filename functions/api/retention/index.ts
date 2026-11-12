import { retentionResetSchema } from '../../../shared/schemas'
import type { Folder, RetentionSummary } from '../../../shared/types'
import { getAccountRow, listAccountRows } from '../../_lib/db'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import {
  getMetadataRetentionDays,
  getRetentionStats,
  resetMirrorCursors,
} from '../../_lib/retention'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'
import { queueSync } from '../../_lib/sync'

async function summary(env: Env): Promise<RetentionSummary> {
  const [days, stats] = await Promise.all([getMetadataRetentionDays(env), getRetentionStats(env)])
  return {
    days,
    lastRunAt: stats.lastRunAt,
    lastDeleted: stats.lastDeleted,
    deletedTotal: stats.deletedTotal,
    cutoff: stats.cutoff,
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    return json({ retention: await summary(context.env) })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

/**
 * Forget the sync cursors so the mirror is rebuilt from the provider.
 *
 * Retention deletes old metadata from D1; the incremental sync will not fetch
 * those rows again because it tracks UID windows instead of re-scanning. This
 * action restarts that scan for the given IMAP account (or for all of them) and
 * queues the first chunk, which is how pruned messages become visible again.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await readJson<unknown>(context.request)
    const parsed = retentionResetSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return fail(
        'Invalid request',
        400,
        parsed.error.issues.map((issue) => issue.message).join('; '),
        'retention_invalid',
      )
    }
    const requested = parsed.data.accountId
    let accounts
    if (requested) {
      const row = await getAccountRow(context.env, requested)
      if (!row || row.kind !== 'imap') {
        return fail('Account not found', 404, undefined, 'account_not_found')
      }
      accounts = [row]
    } else {
      accounts = (await listAccountRows(context.env)).filter((row) => row.kind === 'imap')
    }

    // Resetting the cursor deletes every folder row, so each of them bootstraps
    // again on its next sync. A single account can afford all four folders right
    // away; asking for every account only starts the Inbox to stay inside the
    // Worker's subrequest budget (the rest follow when opened or via auto sync).
    const foldersToSync: Folder[] = requested ? ['inbox', 'sent', 'draft', 'spam'] : ['inbox']
    let folders = 0
    for (const account of accounts) {
      folders += await resetMirrorCursors(context.env, account.id)
      for (const folder of foldersToSync) {
        await queueSync(context.env, account, folder, (promise) => context.waitUntil(promise)).catch(
          () => undefined,
        )
      }
    }
    return json({ ok: true, accounts: accounts.length, folders, retention: await summary(context.env) })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}
