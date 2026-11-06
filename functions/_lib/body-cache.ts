import type { Env } from './env'
import { isSchemaError } from './schema'

const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000
export const MAX_CACHED_BODY_BYTES = 512 * 1024
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

export async function putCachedBody(
  env: Env,
  messageId: string,
  bytes: Uint8Array,
): Promise<void> {
  if (cacheAvailable === false || bytes.byteLength > MAX_CACHED_BODY_BYTES) {
    return
  }
  try {
    await env.DB.prepare(
      `INSERT INTO imap_body_cache (message_id, body, size, cached_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET
         body = excluded.body,
         size = excluded.size,
         cached_at = excluded.cached_at`,
    )
      .bind(messageId, bytes, bytes.byteLength, new Date().toISOString())
      .run()
    cacheAvailable = true
    writesSinceCleanup += 1
    if (writesSinceCleanup >= 50) {
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

export async function cleanupBodyCache(env: Env): Promise<void> {
  if (cacheAvailable === false) {
    return
  }
  try {
    await env.DB.prepare('DELETE FROM imap_body_cache WHERE cached_at < ?')
      .bind(new Date(Date.now() - CACHE_TTL_MS).toISOString())
      .run()
    cacheAvailable = true
  } catch (error) {
    if (isSchemaError(error)) {
      cacheAvailable = false
    }
  }
}
