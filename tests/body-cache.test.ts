import { describe, expect, it } from 'vitest'
import type { Env } from '../functions/_lib/env'
import {
  cleanupBodyCache,
  MAX_CACHE_BYTES,
  MAX_CACHED_BODY_BYTES,
} from '../functions/_lib/body-cache'

interface FakeDb {
  sumCalls: number
  evictions: number
  expiredDeletes: number
}

interface FakeStatement {
  bind: (...args: unknown[]) => FakeStatement
  run: () => Promise<{ meta: { changes: number } }>
  first: () => Promise<{ total: number } | null>
}

function fakeEnv(totals: number[]): { env: Env; db: FakeDb } {
  const db: FakeDb = { sumCalls: 0, evictions: 0, expiredDeletes: 0 }
  const statement = (sql: string): FakeStatement => {
    const self: FakeStatement = {
      bind() {
        return self
      },
      async run() {
        if (sql.includes('cached_at <')) {
          db.expiredDeletes += 1
          return { meta: { changes: 0 } }
        }
        if (sql.includes('message_id IN')) {
          db.evictions += 1
          return { meta: { changes: 100 } }
        }
        return { meta: { changes: 0 } }
      },
      async first() {
        if (sql.includes('SUM(size)')) {
          const total = totals[Math.min(db.sumCalls, totals.length - 1)] ?? 0
          db.sumCalls += 1
          return { total }
        }
        return null
      },
    }
    return self
  }
  return {
    env: { DB: { prepare: statement } } as unknown as Env,
    db,
  }
}

describe('body cache cleanup', () => {
  it('evicts the oldest rows when over the hard cap', async () => {
    const { env, db } = fakeEnv([MAX_CACHE_BYTES + MAX_CACHED_BODY_BYTES * 200, 0])
    await cleanupBodyCache(env)
    expect(db.expiredDeletes).toBe(1)
    expect(db.evictions).toBeGreaterThan(0)
    expect(db.sumCalls).toBeGreaterThanOrEqual(2)
  })

  it('does not evict when the cache is within budget', async () => {
    const { env, db } = fakeEnv([MAX_CACHE_BYTES - 1])
    await cleanupBodyCache(env)
    expect(db.expiredDeletes).toBe(1)
    expect(db.evictions).toBe(0)
  })
})
