/**
 * Drive one folder's sync to the end.
 *
 * A chunk reports `hasMore: true` while the folder is still `partial`, so the
 * chain keeps asking for the next one instead of waiting for the list to be
 * refreshed or for a TTL to expire. It stops when the folder is done, when an
 * error arrives, when another worker holds the lock (`locked`), or when the cap
 * is reached — the last case leaves the folder partial for the next load.
 */
export interface SyncChunkResult {
  hasMore: boolean
  locked?: boolean
  error?: string
  /**
   * How much has been synced so far (for example the folder's `synced` count).
   * A chunk that leaves it unchanged made no progress.
   */
  progress?: number
}

export interface SyncChainOptions {
  /** Hard cap on chunks per call, so a broken server cannot spin forever. */
  max?: number
  /** Pause between chunks, in ms. */
  delayMs?: number
  /** Injectable for tests. */
  wait?: (ms: number) => Promise<void>
  /**
   * How many chunks in a row may make no progress before the chain gives up
   * (the first chunk only sets the baseline). Without it a folder that keeps
   * reporting `hasMore` — an archive write that always fails, say — would
   * restart the chain forever.
   */
  stallLimit?: number
}

export interface SyncChainResult {
  chunks: number
  done: boolean
  locked: boolean
  /** The folder stopped advancing: worth telling the user. */
  stalled?: boolean
  error?: string
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function runSyncChain(
  run: () => Promise<SyncChunkResult>,
  options: SyncChainOptions = {},
): Promise<SyncChainResult> {
  const max = options.max ?? 40
  const delayMs = options.delayMs ?? 200
  const wait = options.wait ?? sleep
  const stallLimit = options.stallLimit ?? 3
  let chunks = 0
  let locked = false
  let lastProgress: number | null = null
  let stalledChunks = 0

  while (chunks < max) {
    const result = await run()
    chunks += 1
    if (result.error) {
      return { chunks, done: false, locked: result.locked ?? false, error: result.error }
    }
    if (result.locked) {
      locked = true
      return { chunks, done: false, locked }
    }
    if (!result.hasMore) {
      return { chunks, done: true, locked: false }
    }
    if (typeof result.progress === 'number') {
      if (lastProgress !== null && result.progress <= lastProgress) {
        stalledChunks += 1
        if (stalledChunks >= stallLimit) {
          return { chunks, done: false, locked: false, stalled: true }
        }
      } else {
        stalledChunks = 0
      }
      lastProgress = Math.max(lastProgress ?? result.progress, result.progress)
    }
    if (chunks < max) {
      await wait(delayMs)
    }
  }
  return { chunks, done: false, locked }
}

/**
 * What a finished chain should do next.
 *
 * Reaching the cap or meeting a lock is not a failure: the folder is still
 * partial and nobody will come back to it on its own, so another chain is
 * scheduled after a short pause. Returns `null` when there is nothing to resume.
 */
export function nextChainDelay(
  result: SyncChainResult,
  options: { resumeMs?: number; lockedMs?: number } = {},
): number | null {
  if (result.done || result.error || result.stalled) {
    return null
  }
  if (result.locked) {
    return options.lockedMs ?? 5000
  }
  return options.resumeMs ?? 500
}
