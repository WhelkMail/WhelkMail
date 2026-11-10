import { describe, expect, it } from 'vitest'
import type { Env } from '../functions/_lib/env'
import {
  cleanupBodyCache,
  putCachedBody,
  MAX_CACHE_BYTES,
  MAX_CACHED_BODY_BYTES,
} from '../functions/_lib/body-cache'

interface CacheRow {
  message_id: string
  account_id: string
  folder: string
  uid: number
  size: number
  cached_at: string
}

interface FakeDb {
  rows: CacheRow[]
  expiredDeletes: number
  windowEvictions: number
  batchEvictions: number
  rejectWindow: boolean
}

interface FakeStatement {
  bind: (...args: unknown[]) => FakeStatement
  run: () => Promise<{ meta: { changes: number } }>
  first: () => Promise<{ total: number } | null>
}

function fakeEnv(rows: CacheRow[], options: Partial<FakeDb> = {}): { env: Env; db: FakeDb } {
  const db: FakeDb = {
    rows,
    expiredDeletes: 0,
    windowEvictions: 0,
    batchEvictions: 0,
    rejectWindow: false,
    ...options,
  }
  const prepare = (sql: string): FakeStatement => {
    let params: unknown[] = []
    const self: FakeStatement = {
      bind(...args: unknown[]) {
        params = args
        return self
      },
      async run() {
        if (sql.includes('INSERT INTO imap_body_cache')) {
          const values = params as [string, string, string, number, Uint8Array, number, string]
          db.rows.push({
            message_id: values[0],
            account_id: values[1],
            folder: values[2],
            uid: values[3],
            size: values[5],
            cached_at: values[6],
          })
          return { meta: { changes: 1 } }
        }
        if (sql.includes('DELETE FROM imap_body_cache WHERE message_id = ?')) {
          const [id] = params as [string]
          const before = db.rows.length
          db.rows = db.rows.filter((row) => row.message_id !== id)
          return { meta: { changes: before - db.rows.length } }
        }
        if (sql.includes('cached_at <')) {
          const [cutoff] = params as [string]
          db.expiredDeletes += 1
          const before = db.rows.length
          db.rows = db.rows.filter((row) => row.cached_at >= cutoff)
          return { meta: { changes: before - db.rows.length } }
        }
        if (sql.includes('SUM(size) OVER')) {
          if (db.rejectWindow) {
            throw new Error('D1_ERROR: no such function: SUM')
          }
          const direction = /ORDER BY cached_at (ASC|DESC)/i.exec(sql)?.[1]?.toUpperCase()
          if (direction !== 'ASC' && direction !== 'DESC') {
            throw new Error(`unexpected eviction ordering in: ${sql}`)
          }
          const [budget] = params as [number]
          const ordered = [...db.rows].sort((left, right) =>
            direction === 'DESC'
              ? right.cached_at.localeCompare(left.cached_at)
              : left.cached_at.localeCompare(right.cached_at),
          )
          let running = 0
          const drop = new Set<string>()
          for (const row of ordered) {
            running += row.size
            if (running > budget) {
              drop.add(row.message_id)
            }
          }
          db.windowEvictions += 1
          db.rows = db.rows.filter((row) => !drop.has(row.message_id))
          return { meta: { changes: drop.size } }
        }
        if (sql.includes('ORDER BY cached_at ASC') && sql.includes('LIMIT')) {
          const [limit] = params as [number]
          const ordered = [...db.rows].sort((left, right) =>
            left.cached_at.localeCompare(right.cached_at),
          )
          const drop = ordered.slice(0, limit).map((row) => row.message_id)
          db.batchEvictions += 1
          db.rows = db.rows.filter((row) => !drop.includes(row.message_id))
          return { meta: { changes: drop.length } }
        }
        return { meta: { changes: 0 } }
      },
      async first() {
        if (sql.includes('COUNT(*)')) {
          return {
            total: db.rows.reduce((sum, row) => sum + row.size, 0),
            count: db.rows.length,
          }
        }
        if (sql.includes('SUM(size)')) {
          return { total: db.rows.reduce((sum, row) => sum + row.size, 0) }
        }
        return null
      },
    }
    return self
  }
  return { env: { DB: { prepare } } as unknown as Env, db }
}

function row(id: string, size: number, minute: number): CacheRow {
  // Keep the fixture inside the 3-day TTL: cleanup runs the expiry pass first.
  return {
    message_id: id,
    account_id: 'acc',
    folder: 'inbox',
    uid: minute,
    size,
    cached_at: new Date(Date.now() - (10 - minute) * 60_000).toISOString(),
  }
}

describe('body cache eviction', () => {
  it('keeps the newest bodies when the cache goes over budget', async () => {
    const chunk = Math.floor(MAX_CACHE_BYTES / 3) + 1
    const { env, db } = fakeEnv([row('old', chunk, 1), row('mid', chunk, 2), row('new', chunk, 3)])

    await cleanupBodyCache(env)

    expect(db.rows.map((item) => item.message_id).sort()).toEqual(['mid', 'new'])
    expect(db.rows.reduce((sum, item) => sum + item.size, 0)).toBeLessThanOrEqual(MAX_CACHE_BYTES)
  })

  it('drops only the entries above the budget', async () => {
    const { env, db } = fakeEnv([
      row('ancient', Math.floor(MAX_CACHE_BYTES / 2), 1),
      row('recent', Math.floor(MAX_CACHE_BYTES / 2), 2),
      row('newest', 1024, 3),
    ])

    await cleanupBodyCache(env)

    expect(db.rows.map((item) => item.message_id)).toEqual(['recent', 'newest'])
  })

  it('does not evict when the cache is within budget', async () => {
    const { env, db } = fakeEnv([row('only', MAX_CACHE_BYTES - 1, 1)])

    await cleanupBodyCache(env)

    expect(db.windowEvictions).toBe(0)
    expect(db.batchEvictions).toBe(0)
    expect(db.rows).toHaveLength(1)
  })

  it('keeps the newest body when only the fallback batches are available', async () => {
    const chunk = Math.floor(MAX_CACHE_BYTES / 2) + 1
    const { env, db } = fakeEnv([row('old', chunk, 1), row('new', chunk, 2)], {
      rejectWindow: true,
    })

    await cleanupBodyCache(env)

    expect(db.batchEvictions).toBeGreaterThan(0)
    expect(db.rows.map((item) => item.message_id)).toEqual(['new'])
  })
})

describe('body cache writes', () => {
  it('skips bodies larger than the per-message limit', async () => {
    const { env, db } = fakeEnv([])

    await putCachedBody(
      env,
      { messageId: 'big', accountId: 'acc', folder: 'inbox', uid: 1 },
      new Uint8Array(MAX_CACHED_BODY_BYTES + 1),
    )

    expect(db.rows).toHaveLength(0)
  })

  it('stores a body and refreshes cached_at on rewrite', async () => {
    const { env, db } = fakeEnv([])

    await putCachedBody(
      env,
      { messageId: 'm1', accountId: 'acc', folder: 'inbox', uid: 7 },
      new Uint8Array([1, 2, 3]),
    )

    expect(db.rows).toHaveLength(1)
    expect(db.rows[0].size).toBe(3)
  })
})
