import type { Folder } from '../../shared/types'
import type { Env } from './env'
import { isSchemaError } from './schema'

const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000
export const MAX_CACHED_BODY_BYTES = 512 * 1024
export const MAX_CACHE_BYTES = 64 * 1024 * 1024
const CLEANUP_WRITE_INTERVAL = 50
const EVICTION_BATCH = 100
const MAX_EVICTION_PASSES = 5
let cacheAvailable: boolean | null = null
let writesSinceCleanup = 0

function toBytes(value: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (value instanceof Uint8Array) {
    return value
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value)
  }
  return new Uint8Array(value)
}

export async function getCachedBody(env: Env, messageId: string): Promise<Uint8Array | null> {
  if (cacheAvailable === false) {
    return null
  }
  try {
    const row = await env.DB.prepare(
      'SELECT body, cached_at FROM imap_body_cache WHERE message_id = ?',
    )
      .bind(messageId)
      .first<{ body: ArrayBuffer | Uint8Array | number[]; cached_at: string }>()
    cacheAvailable = true
    if (!row) {
      return null
    }
    const cachedAt = Date.parse(row.cached_at)
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > CACHE_TTL_MS) {
      await env.DB.prepare('DELETE FROM imap_body_cache WHERE message_id = ?')
        .bind(messageId)
        .run()
        .catch(() => undefined)
      return null
    }
    return toBytes(row.body)
  } catch (error) {
    if (isSchemaError(error)) {
      cacheAvailable = false
    }
    return null
  }
}

export interface CachedBodyKey {
  messageId: string
  accountId: string
  folder: Folder
  uid: number
}

export async function putCachedBody(
  env: Env,
  key: CachedBodyKey,
  bytes: Uint8Array,
): Promise<void> {
  if (cacheAvailable === false || bytes.byteLength > MAX_CACHED_BODY_BYTES) {
    return
  }
  try {
    await env.DB.prepare(
      `INSERT INTO imap_body_cache (message_id, account_id, folder, uid, body, size, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET
         account_id = excluded.account_id,
         folder = excluded.folder,
         uid = excluded.uid,
         body = excluded.body,
         size = excluded.size,
         cached_at = excluded.cached_at`,
    )
      .bind(
        key.messageId,
        key.accountId,
        key.folder,
        key.uid,
        bytes,
        bytes.byteLength,
        new Date().toISOString(),
      )
      .run()
    cacheAvailable = true
    writesSinceCleanup += 1
    if (writesSinceCleanup >= CLEANUP_WRITE_INTERVAL) {
      writesSinceCleanup = 0
      void cleanupBodyCache(env).catch(() => undefined)
    }
  } catch (error) {
    if (isSchemaError(error)) {
      cacheAvailable = false
      return
    }
    // Best-effort cache: ignore quota or per-row size errors.
  }
}

export function bodyCacheAvailable(): boolean {
  return cacheAvailable !== false
}

async function cacheBytes(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE(SUM(size), 0) AS total FROM imap_body_cache',
  ).first<{ total: number }>()
  return row?.total ?? 0
}

async function evictOldest(env: Env, limit: number): Promise<number> {
  const result = await env.DB.prepare(
    `DELETE FROM imap_body_cache WHERE message_id IN (
       SELECT message_id FROM imap_body_cache
       ORDER BY cached_at ASC
       LIMIT ?
     )`,
  )
    .bind(limit)
    .run()
  return result.meta.changes ?? 0
}

export async function cleanupBodyCache(env: Env): Promise<void> {
  if (cacheAvailable === false) {
    return
  }
  try {
    const expired = await env.DB.prepare('DELETE FROM imap_body_cache WHERE cached_at < ?')
      .bind(new Date(Date.now() - CACHE_TTL_MS).toISOString())
      .run()
    let totalBytes = await cacheBytes(env)
    let evicted = 0

    if (totalBytes > MAX_CACHE_BYTES) {
      try {
        const result = await env.DB.prepare(
          `DELETE FROM imap_body_cache WHERE message_id IN (
             SELECT message_id FROM (
               SELECT message_id,
                 SUM(size) OVER (
                   ORDER BY cached_at ASC
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                 ) AS running
               FROM imap_body_cache
             )
             WHERE running > ?
           )`,
        )
          .bind(MAX_CACHE_BYTES)
          .run()
        evicted += result.meta.changes ?? 0
      } catch (error) {
        if (isSchemaError(error)) {
          cacheAvailable = false
          return
        }
        console.log('[body-cache] window eviction failed, using batches')
      }
      totalBytes = await cacheBytes(env)
    }

    let passes = 0
    while (totalBytes > MAX_CACHE_BYTES && passes < MAX_EVICTION_PASSES) {
      const removed = await evictOldest(env, EVICTION_BATCH)
      if (removed === 0) {
        break
      }
      evicted += removed
      totalBytes = await cacheBytes(env)
      passes += 1
    }

    cacheAvailable = true
    const expiredCount = expired.meta.changes ?? 0
    if (expiredCount > 0 || evicted > 0 || totalBytes > MAX_CACHE_BYTES) {
      console.log(
        `[body-cache] cleanup expired=${expiredCount} evicted=${evicted} bytes=${totalBytes} max=${MAX_CACHE_BYTES}`,
      )
    }
  } catch (error) {
    if (isSchemaError(error)) {
      cacheAvailable = false
    }
  }
}
