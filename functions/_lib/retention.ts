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
  return { days, deleted, cutoff, truncated }
}
