import { describe, expect, it } from 'vitest'
import {
  clampPageSize,
  compareByDateDesc,
  decodePageCursor,
  encodePageCursor,
  mergePage,
  pageOf,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../shared/paging'

describe('page size', () => {
  it('falls back to the default for missing or invalid values', () => {
    expect(clampPageSize(null)).toBe(DEFAULT_PAGE_SIZE)
    expect(clampPageSize(Number.NaN)).toBe(DEFAULT_PAGE_SIZE)
    expect(clampPageSize(0)).toBe(DEFAULT_PAGE_SIZE)
    expect(clampPageSize(-5)).toBe(DEFAULT_PAGE_SIZE)
  })

  it('caps the page size', () => {
    expect(clampPageSize(MAX_PAGE_SIZE + 500)).toBe(MAX_PAGE_SIZE)
    expect(clampPageSize(12.7)).toBe(12)
  })
})

describe('page cursors', () => {
  it('round-trips a date and an id', () => {
    const cursor = { date: '2026-11-09T10:00:00.000Z', id: 'imap:acc:inbox:42' }
    expect(decodePageCursor(encodePageCursor(cursor))).toEqual(cursor)
  })

  it('keeps ids with separators intact', () => {
    const cursor = { date: '2026-11-09T10:00:00.000Z', id: 'relay~acc~1' }
    expect(decodePageCursor(encodePageCursor(cursor))).toEqual(cursor)
  })

  it('rejects malformed cursors instead of paging from nowhere', () => {
    expect(decodePageCursor(null)).toBeNull()
    expect(decodePageCursor('')).toBeNull()
    expect(decodePageCursor('no-separator')).toBeNull()
    expect(decodePageCursor('~only-id')).toBeNull()
    expect(decodePageCursor('%E0%A4%A~id')).toBeNull()
  })
})

function message(id: string, date: string) {
  return { id, date }
}

describe('pageOf', () => {
  it('returns a cursor when a full page is returned', () => {
    const items = [message('c', '2026-11-09'), message('b', '2026-11-08')]
    const page = pageOf(items, 2)
    expect(page.items.map((item) => item.id)).toEqual(['c', 'b'])
    expect(decodePageCursor(page.nextCursor)?.id).toBe('b')
  })

  it('returns no cursor on the last page', () => {
    const page = pageOf([message('a', '2026-11-07')], 2)
    expect(page.nextCursor).toBeNull()
  })

  it('trims merged sources to one page', () => {
    const items = [
      message('a', '2026-11-09'),
      message('b', '2026-11-08'),
      message('c', '2026-11-07'),
    ]
    expect(pageOf(items, 2).items.map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('mergePage', () => {
  it('appends new messages and drops duplicates', () => {
    const current = [message('a', '2026-11-09'), message('b', '2026-11-08')]
    const incoming = [message('b', '2026-11-08'), message('c', '2026-11-07')]
    expect(mergePage(current, incoming).map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps the current list when the page is empty', () => {
    const current = [message('a', '2026-11-09')]
    expect(mergePage(current, [])).toBe(current)
  })
})

describe('compareByDateDesc', () => {
  it('orders ties by descending id, like ORDER BY sent_at DESC, id DESC', () => {
    const items = [
      message('a', '2026-11-09T10:00:00.000Z'),
      message('c', '2026-11-09T10:00:00.000Z'),
      message('b', '2026-11-09T10:00:00.000Z'),
    ]
    expect(items.sort(compareByDateDesc).map((item) => item.id)).toEqual(['c', 'b', 'a'])
  })

  it('keeps dates descending across different timestamps', () => {
    const items = [
      message('b', '2026-11-08T10:00:00.000Z'),
      message('z', '2026-11-09T10:00:00.000Z'),
      message('a', '2026-11-07T10:00:00.000Z'),
    ]
    expect(items.sort(compareByDateDesc).map((item) => item.id)).toEqual(['z', 'b', 'a'])
  })

  it('walks messages sharing a timestamp without skipping any', () => {
    // A page boundary inside one timestamp is where an ascending tie-break used
    // to serve the same rows twice and, after client-side dedupe, lose the rest.
    const date = '2026-11-09T10:00:00.000Z'
    const all = ['a', 'b', 'c', 'd', 'e'].map((id) => message(id, date))
    const sorted = [...all].sort(compareByDateDesc)

    const first = pageOf(sorted, 2)
    expect(first.items.map((item) => item.id)).toEqual(['e', 'd'])

    const cursor = decodePageCursor(first.nextCursor)
    expect(cursor).toEqual({ date, id: 'd' })

    // Same predicate as the SQL page clause:
    // sent_at < ? OR (sent_at = ? AND id < ?)
    const rest = all
      .filter((item) => item.date < cursor.date || (item.date === cursor.date && item.id < cursor.id))
      .sort(compareByDateDesc)
    expect(rest.map((item) => item.id)).toEqual(['c', 'b', 'a'])
  })
})
