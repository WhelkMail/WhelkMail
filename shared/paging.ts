/**
 * Keyset pagination helpers shared by the API and the client.
 *
 * The cursor is the (date, id) pair of the last message of a page: the next
 * query asks for everything strictly older. Unlike OFFSET this stays correct
 * while new mail arrives between two pages.
 */

const SEPARATOR = '~'

export interface PageCursor {
  date: string
  id: string
}

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100

export function clampPageSize(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_PAGE_SIZE
  }
  return Math.min(MAX_PAGE_SIZE, Math.floor(value))
}

export function encodePageCursor(cursor: PageCursor): string {
  return `${encodeURIComponent(cursor.date)}${SEPARATOR}${encodeURIComponent(cursor.id)}`
}

export function decodePageCursor(value: string | null | undefined): PageCursor | null {
  if (!value) {
    return null
  }
  const index = value.indexOf(SEPARATOR)
  if (index <= 0 || index === value.length - 1) {
    return null
  }
  try {
    const date = decodeURIComponent(value.slice(0, index))
    const id = decodeURIComponent(value.slice(index + 1))
    if (!date || !id) {
      return null
    }
    return { date, id }
  } catch {
    return null
  }
}

export interface Pageable {
  id: string
  date: string
}

/**
 * Cut a merged, already sorted-descending list to one page and return the
 * cursor for the next one.
 */
export function pageOf<T extends Pageable>(
  items: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const page = items.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor = page.length >= limit && last ? encodePageCursor({ date: last.date, id: last.id }) : null
  return { items: page, nextCursor }
}

/**
 * Sort merged pages exactly like the SQL side does (`ORDER BY sent_at DESC,
 * id DESC`).
 *
 * The cursor is the (date, id) of the last message of a page and the next query
 * asks for `sent_at < date OR (sent_at = date AND id < id)`. If the merge
 * ordered ties by ascending id while the query orders them descending, two
 * messages sharing a timestamp would be served twice and, after the client
 * deduplicates them, silently drop out of the list. Keep both sides in step.
 */
export function compareByDateDesc<T extends Pageable>(left: T, right: T): number {
  const delta = (Date.parse(right.date) || 0) - (Date.parse(left.date) || 0)
  if (delta !== 0) {
    return delta
  }
  return right.id.localeCompare(left.id)
}

/** Append a page, dropping messages that were already displayed. */
export function mergePage<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  if (incoming.length === 0) {
    return current
  }
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !seen.has(item.id))]
}
