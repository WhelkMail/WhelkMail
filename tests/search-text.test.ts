import { describe, expect, it } from 'vitest'
import type { Env } from '../functions/_lib/env'
import {
  indexMessageText,
  normalizeSearchText,
  snippetOfSearchText,
  MAX_SEARCH_TEXT_CHARS,
  MAX_SNIPPET_CHARS,
} from '../functions/_lib/mail/search-text'

interface FakeDb {
  updates: { sql: string; params: unknown[] }[]
  rejectSearchColumn: boolean
}

function fakeEnv(options: Partial<FakeDb> = {}): { env: Env; db: FakeDb } {
  const db: FakeDb = { updates: [], rejectSearchColumn: false, ...options }
  const prepare = (sql: string) => {
    let params: unknown[] = []
    const self = {
      bind(...args: unknown[]) {
        params = args
        return self
      },
      async run() {
        if (sql.includes('search_text') && db.rejectSearchColumn) {
          throw new Error('D1_ERROR: table imap_messages has no column named search_text')
        }
        db.updates.push({ sql, params })
        return { meta: { changes: 1 } }
      },
    }
    return self
  }
  return { env: { DB: { prepare } } as unknown as Env, db }
}

describe('search text normalization', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeSearchText('  hello\n\n  world\t ')).toBe('hello world')
  })

  it('caps the stored text', () => {
    expect(normalizeSearchText('x'.repeat(MAX_SEARCH_TEXT_CHARS + 100))).toHaveLength(
      MAX_SEARCH_TEXT_CHARS,
    )
  })

  it('builds a short snippet from the normalized text', () => {
    expect(snippetOfSearchText('a'.repeat(500))).toHaveLength(MAX_SNIPPET_CHARS)
    expect(snippetOfSearchText('   ')).toBe('')
  })
})

describe('indexMessageText', () => {
  it('updates snippet and search text in one statement', async () => {
    const { env, db } = fakeEnv()

    await indexMessageText(env, 'm1', `Hello\n\nworld ${'y'.repeat(500)}`)

    expect(db.updates).toHaveLength(1)
    expect(db.updates[0].sql).toContain('search_text')
    const [snippet, text, id] = db.updates[0].params as [string, string, string]
    expect(id).toBe('m1')
    expect(snippet).toHaveLength(MAX_SNIPPET_CHARS)
    expect(text.startsWith('Hello world y')).toBe(true)
  })

  it('still writes the snippet on a database without migration 019', async () => {
    const { env, db } = fakeEnv({ rejectSearchColumn: true })

    await indexMessageText(env, 'm2', 'fallback body')

    expect(db.updates).toHaveLength(1)
    expect(db.updates[0].sql).not.toContain('search_text')
    expect(db.updates[0].params).toEqual(['fallback body', 'm2'])
  })

  it('skips empty bodies', async () => {
    const { env, db } = fakeEnv()

    await indexMessageText(env, 'm3', '   \n  ')

    expect(db.updates).toHaveLength(0)
  })
})
