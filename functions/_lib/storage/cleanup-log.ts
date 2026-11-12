import type { Env } from '../env'
import { isSchemaError } from '../schema'

/** An object that could not be removed while purging an account. */
export interface PurgeFailure {
  driver: string
  key: string
  error: string
}

/** One stored row, as shown in Settings → System. */
export interface CleanupLogEntry {
  id: string
  accountId: string
  accountEmail: string
  driver: string
  key: string
  error: string
  createdAt: string
}

export const CLEANUP_LOG_LIMIT = 50

/**
 * Deletions happen before the account row disappears, and the Drive token goes
 * with it: a failed removal cannot be retried afterwards. The log is therefore
 * the only trace, so it is kept small and capped.
 */
export function capFailures(failures: PurgeFailure[], limit = CLEANUP_LOG_LIMIT): PurgeFailure[] {
  const seen = new Set<string>()
  const capped: PurgeFailure[] = []
  for (const failure of failures) {
    const id = `${failure.driver}:${failure.key}`
    if (!failure.key || seen.has(id)) {
      continue
    }
    seen.add(id)
    capped.push(failure)
    if (capped.length >= limit) {
      break
    }
  }
  return capped
}

export async function recordCleanupFailures(
  env: Env,
  account: { id: string; email: string },
  failures: PurgeFailure[],
): Promise<number> {
  const entries = capFailures(failures)
  if (entries.length === 0) {
    return 0
  }
  const createdAt = new Date().toISOString()
  const statements = entries.map((entry) =>
    env.DB.prepare(
      'INSERT INTO storage_cleanup_log (id, account_id, account_email, driver, object_key, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(),
      account.id,
      account.email,
      entry.driver,
      entry.key,
      entry.error,
      createdAt,
    ),
  )
  await env.DB.batch(statements)
  return entries.length
}

export async function listCleanupFailures(env: Env, limit = CLEANUP_LOG_LIMIT): Promise<CleanupLogEntry[]> {
  try {
    const rows = await env.DB.prepare(
      'SELECT id, account_id, account_email, driver, object_key, error, created_at FROM storage_cleanup_log ORDER BY created_at DESC LIMIT ?',
    )
      .bind(limit)
      .all<{
        id: string
        account_id: string
        account_email: string
        driver: string
        object_key: string
        error: string | null
        created_at: string
      }>()
    return rows.results.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      accountEmail: row.account_email,
      driver: row.driver,
      key: row.object_key,
      error: row.error ?? '',
      createdAt: row.created_at,
    }))
  } catch (error) {
    if (isSchemaError(error)) {
      return []
    }
    throw error
  }
}

export async function clearCleanupFailures(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM storage_cleanup_log').run()
}
