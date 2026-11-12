import type { Env } from './env'
import { isSchemaError } from './schema'

export const METADATA_RETENTION_KEY = 'metadata_retention_days'
const RETENTION_BATCH = 500
const RETENTION_MAX_PER_RUN = 5000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How many days of IMAP metadata to keep. 0 means "keep everything", which is
 * the default: the mirror is what makes the list instant, so deleting from it
 * is opt-in.
 */
export async function getMetadataRetentionDays(env: Env): Promise<number> {
  try {
    const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
      .bind(METADATA_RETENTION_KEY)
      .first<{ value: string }>()
    const days = Number(row?.value ?? '0')
    if (!Number.isFinite(days) || days <= 0) {
      return 0
    }
    return Math.floor(days)
  } catch (error) {
    if (isSchemaError(error)) {
      return 0
    }
    throw error
  }
}

export interface RetentionResult {
  days: number
  deleted: number
  cutoff: string | null
  truncated: boolean
}

/**
 * Drop mirrored IMAP metadata older than the retention window.
 *
 * Only rows that the sync no longer needs are removed: incremental sync tracks
 * `maxUid`/`minUid`, so a pruned message is not pulled back from the provider.
 * Drafts are never pruned because the draft list is served from the mirror and
 * the provider copy is the only way to reopen them.
 */
export async function pruneMirroredMetadata(
  env: Env,
  now = Date.now(),
): Promise<RetentionResult> {
  const days = await getMetadataRetentionDays(env)
  if (days <= 0) {
    return { days: 0, deleted: 0, cutoff: null, truncated: false }
  }
  const cutoff = new Date(now - days * DAY_MS).toISOString()
  let deleted = 0
  let truncated = false

  while (true) {
    if (deleted >= RETENTION_MAX_PER_RUN) {
      truncated = true
      break
    }
    let rows: { id: string }[]
    try {
      const result = await env.DB.prepare(
        `SELECT id FROM imap_messages
         WHERE folder <> 'draft' AND sent_at < ?
         ORDER BY sent_at ASC LIMIT ?`,
      )
        .bind(cutoff, RETENTION_BATCH)
        .all<{ id: string }>()
      rows = result.results
    } catch (error) {
      if (isSchemaError(error)) {
        break
      }
      throw error
    }
    if (rows.length === 0) {
      break
    }
    const ids = rows.map((row) => row.id)
    const placeholders = ids.map(() => '?').join(', ')
    const statements = [
      env.DB.prepare(`DELETE FROM message_labels WHERE message_id IN (${placeholders})`).bind(
        ...ids,
      ),
      env.DB.prepare(`DELETE FROM imap_messages WHERE id IN (${placeholders})`).bind(...ids),
    ]
    await env.DB.batch(statements)
    deleted += ids.length
    if (rows.length < RETENTION_BATCH) {
      break
    }
  }

  if (deleted > 0) {
    console.log(`[retention] deleted=${deleted} days=${days} cutoff=${cutoff} truncated=${truncated}`)
  }
  await recordRetentionRun(env, { deleted, cutoff }).catch((error) => {
    if (!isSchemaError(error)) {
      console.log(`[retention] stats not saved: ${error instanceof Error ? error.message : error}`)
    }
  })
  return { days, deleted, cutoff, truncated }
}

export const RETENTION_STATS_KEY = 'retention_stats'

export interface RetentionStats {
  /** ISO timestamp of the last pruning run, or null when it never ran. */
  lastRunAt: string | null
  /** Messages removed by the last run. */
  lastDeleted: number
  /** Messages removed since the counter was introduced. */
  deletedTotal: number
  /** Oldest `sent_at` still kept by the last run. */
  cutoff: string | null
}

export const EMPTY_RETENTION_STATS: RetentionStats = {
  lastRunAt: null,
  lastDeleted: 0,
  deletedTotal: 0,
  cutoff: null,
}

function toCount(value: unknown): number {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

/** Tolerant reader for the stored counter (old rows or hand-edited values). */
export function parseRetentionStats(value: string | null | undefined): RetentionStats {
  if (!value) {
    return { ...EMPTY_RETENTION_STATS }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return { ...EMPTY_RETENTION_STATS }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ...EMPTY_RETENTION_STATS }
  }
  const record = parsed as Record<string, unknown>
  return {
    lastRunAt: typeof record.lastRunAt === 'string' ? record.lastRunAt : null,
    lastDeleted: toCount(record.lastDeleted),
    deletedTotal: toCount(record.deletedTotal),
    cutoff: typeof record.cutoff === 'string' ? record.cutoff : null,
  }
}

/** Fold one run into the stored counter. */
export function mergeRetentionStats(
  previous: RetentionStats,
  run: { at: string; deleted: number; cutoff: string | null },
): RetentionStats {
  return {
    lastRunAt: run.at,
    lastDeleted: toCount(run.deleted),
    deletedTotal: previous.deletedTotal + toCount(run.deleted),
    cutoff: run.cutoff ?? previous.cutoff,
  }
}

export async function getRetentionStats(env: Env): Promise<RetentionStats> {
  try {
    const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
      .bind(RETENTION_STATS_KEY)
      .first<{ value: string }>()
    return parseRetentionStats(row?.value)
  } catch (error) {
    if (isSchemaError(error)) {
      return { ...EMPTY_RETENTION_STATS }
    }
    throw error
  }
}

export async function recordRetentionRun(
  env: Env,
  run: { deleted: number; cutoff: string | null },
): Promise<RetentionStats> {
  const previous = await getRetentionStats(env)
  const next = mergeRetentionStats(previous, {
    at: new Date().toISOString(),
    deleted: run.deleted,
    cutoff: run.cutoff,
  })
  await env.DB.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
    .bind(RETENTION_STATS_KEY, JSON.stringify(next))
    .run()
  return next
}

/**
 * Forget the sync cursors of an IMAP account so the next sync walks the mailbox
 * again and re-ingests the metadata that retention removed.
 *
 * Mirror rows are left in place: the rescan upserts what is still there and
 * recreates what retention pruned. Label assignments were deleted with the
 * pruned rows and cannot be recovered this way.
 */
export async function resetMirrorCursors(env: Env, accountId: string): Promise<number> {
  const result = await env.DB.prepare('DELETE FROM imap_sync WHERE account_id = ?')
    .bind(accountId)
    .run()
  return result.meta?.changes ?? 0
}
