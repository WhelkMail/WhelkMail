/**
 * Pure decisions taken during an IMAP sync chunk.
 *
 * They live outside sync.ts so the behaviour that matters (resuming a backfill,
 * reacting to a changed UIDVALIDITY, advancing the UID window) can be unit
 * tested without an IMAP server or a D1 binding.
 */

export type SyncPhase = 'new' | 'backfill' | 'idle'

export interface SyncWindow {
  maxUid: number
  minUid: number
}

export interface SyncRowLike {
  backfill_done: number | boolean
  synced: number
}

/**
 * UIDVALIDITY changes mean the provider renumbered the mailbox: every cached
 * UID is meaningless and the mirror has to start over.
 */
export function shouldResetOnUidValidity(
  stored: number | null | undefined,
  remote: number | null | undefined,
): boolean {
  return Boolean(stored && remote && stored !== remote)
}

/**
 * A mirror that claims `backfill_done` but holds fewer messages than the
 * provider reports was interrupted halfway, so the backfill has to resume.
 */
export function shouldResumeBackfill(
  row: SyncRowLike | null | undefined,
  remoteExists: number | null | undefined,
): boolean {
  if (!row || !row.backfill_done) {
    return false
  }
  if (remoteExists === null || remoteExists === undefined) {
    return false
  }
  return row.synced < remoteExists
}

/**
 * Move the synced UID window over the UIDs that were just ingested.
 *
 * `new` extends the upper bound (and may bootstrap it), `backfill` only lowers
 * the lower bound. Backfill must never move `maxUid`: the next chunk uses it to
 * detect freshly arrived mail, and a backfill window is always below it.
 */
export function advanceSyncWindow(
  window: SyncWindow,
  uids: number[],
  phase: SyncPhase,
): SyncWindow {
  if (uids.length === 0 || phase === 'idle') {
    return window
  }
  const fetchedMin = Math.min(...uids)
  const fetchedMax = Math.max(...uids)
  const maxUid =
    phase === 'new'
      ? window.maxUid === 0
        ? fetchedMax
        : Math.max(window.maxUid, fetchedMax)
      : window.maxUid
  const minUid = window.minUid === 0 ? fetchedMin : Math.min(window.minUid, fetchedMin)
  return { maxUid, minUid }
}

/**
 * The backfill is complete when the provider has nothing older than the lowest
 * UID already mirrored.
 */
export function isBackfillComplete(input: {
  exists: number | null
  minUid: number
  lowestUid: number | null
}): boolean {
  if (input.exists === 0 || input.minUid <= 1) {
    return true
  }
  return input.lowestUid !== null && input.lowestUid >= input.minUid
}

/** How many snippets the sync may enrich per chunk, per folder. */
export const SNIPPET_BATCH = 4
/** Bodies above this size are opened rarely enough to skip eager indexing. */
export const MAX_INDEXED_BODY_BYTES = 512 * 1024
