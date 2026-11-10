import { describe, expect, it } from 'vitest'
import type { Env } from '../functions/_lib/env'
import { pruneMirroredMetadata } from '../functions/_lib/retention'

interface MessageRow {
  id: string
  folder: string
  sent_at: string
}

interface FakeDb {
  retention: string | null
  messages: MessageRow[]
  labels: string[]
  batches: number
}

function fakeEnv(messages: MessageRow[], retention: string | null): { env: Env; db: FakeDb } {
  const db: FakeDb = { retention, messages, labels: [], batches: 0 }
  const prepare = (sql: string) => {
    let params: unknown[] = []
    const self = {
      bind(...args: unknown[]) {
        params = args
        return self
      },
      async first() {
        if (sql.includes('app_settings')) {
          return db.retention === null ? null : { value: db.retention }
        }
        return null
      },
      async all() {
        if (sql.includes('FROM imap_messages')) {
          const [cutoff, limit] = params as [string, number]
          const results = db.messages
            .filter((row) => row.folder !== 'draft' && row.sent_at < cutoff)
            .sort((left, right) => left.sent_at.localeCompare(right.sent_at))
            .slice(0, limit)
          return { results }
        }
        return { results: [] }
      },
      async run() {
        if (sql.includes('DELETE FROM message_labels')) {
          const ids = params as string[]
          db.labels = db.labels.filter((id) => !ids.includes(id))
          return { meta: { changes: ids.length } }
        }
        if (sql.includes('DELETE FROM imap_messages')) {
          const ids = params as string[]
          const before = db.messages.length
          db.messages = db.messages.filter((row) => !ids.includes(row.id))
          return { meta: { changes: before - db.messages.length } }
        }
        return { meta: { changes: 0 } }
      },
    }
    return self
  }
  const env = {
    DB: {
      prepare,
      async batch(statements: unknown[]) {
        db.batches += 1
        for (const statement of statements) {
          await (statement as { run: () => Promise<unknown> }).run()
        }
        return []
      },
    },
  } as unknown as Env
  return { env, db }
}

function message(id: string, folder: string, daysAgo: number): MessageRow {
  return {
    id,
    folder,
    sent_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
  }
}

describe('metadata retention', () => {
  it('does nothing when retention is disabled', async () => {
    const { env, db } = fakeEnv([message('old', 'inbox', 900)], null)

    const result = await pruneMirroredMetadata(env)

    expect(result).toEqual({ days: 0, deleted: 0, cutoff: null, truncated: false })
    expect(db.messages).toHaveLength(1)
    expect(db.batches).toBe(0)
  })

  it('treats an invalid stored value as disabled', async () => {
    const { env, db } = fakeEnv([message('old', 'inbox', 900)], 'not-a-number')

    expect((await pruneMirroredMetadata(env)).deleted).toBe(0)
    expect(db.messages).toHaveLength(1)
  })

  it('removes old mirrored mail but never drafts', async () => {
    const { env, db } = fakeEnv(
      [
        message('ancient', 'inbox', 200),
        message('old-sent', 'sent', 100),
        message('recent', 'inbox', 5),
        message('old-draft', 'draft', 300),
      ],
      '90',
    )

    const result = await pruneMirroredMetadata(env)

    expect(result.deleted).toBe(2)
    expect(result.days).toBe(90)
    expect(db.messages.map((row) => row.id).sort()).toEqual(['old-draft', 'recent'])
  })

  it('works in batches and stops when the mailbox is clean', async () => {
    const rows = Array.from({ length: 1200 }, (_, index) => message(`m${index}`, 'inbox', 200))

    const { env, db } = fakeEnv(rows, '30')

    const result = await pruneMirroredMetadata(env)

    expect(result.deleted).toBe(1200)
    expect(result.truncated).toBe(false)
    expect(db.messages).toHaveLength(0)
    expect(db.batches).toBe(3)
  })

  it('caps a single run so the cron stays inside its budget', async () => {
    const rows = Array.from({ length: 5200 }, (_, index) => message(`m${index}`, 'inbox', 400))

    const { env, db } = fakeEnv(rows, '30')

    const result = await pruneMirroredMetadata(env)

    expect(result.deleted).toBe(5000)
    expect(result.truncated).toBe(true)
    expect(db.messages).toHaveLength(200)
  })
})
