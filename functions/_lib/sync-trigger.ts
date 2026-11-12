import type { MailboxSyncState } from '../../shared/types'
import type { AccountRow } from './db'
import type { Env } from './env'
import { isSchemaError } from './schema'
import { markSyncError, runSyncChunk } from './sync'

const SYNC_TTL_MS = 5 * 60_000
const BACKFILL_RETRY_MS = 8_000
const syncInFlight = new Set<string>()

/**
 * Whether the mirror of a folder is old enough to warrant a background sync.
 * Shared by the flat list and the grouped one so both refresh the same way.
 */
export function needsBackgroundSync(state: MailboxSyncState | null): boolean {
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

/** One chunk of sync, never blocking the response, at most one per folder. */
export async function runBackgroundSync(
  env: Env,
  account: AccountRow,
  folder: Parameters<typeof runSyncChunk>[2],
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

/**
 * Locks currently held, as `<accountId>:<folder>`.
 *
 * `partial` means "there is more to fetch", not "something is fetching now": the
 * client needs both facts to know whether it should ask for the next chunk.
 */
export async function listActiveSyncLocks(env: Env): Promise<Set<string>> {
  try {
    const rows = await env.DB.prepare(
      'SELECT lock_key FROM imap_sync_locks WHERE expires_at > ?',
    )
      .bind(Date.now())
      .all<{ lock_key: string }>()
    return new Set(rows.results.map((row) => row.lock_key))
  } catch (error) {
    if (isSchemaError(error)) {
      return new Set()
    }
    throw error
  }
}
