/**
 * Which accounts should be asked for the next sync chunk.
 *
 * `partial` means "there is more to fetch", not "someone is fetching now", so
 * the client keeps asking for chunks until the state says done. Two guards keep
 * it polite: accounts that already hold a lock are skipped (they are being
 * worked on) and an account is not asked twice within `minAgeMs`, which is what
 * turns `slice(0, 3)` into a rotating queue instead of always the same three.
 */
export interface SyncQueueInput {
  /**
   * Stale folders as `accountId:folder`, in the order the server returned them.
   * The folder is part of the key: switching from Inbox to Sent must not hit the
   * cooldown recorded for another folder of the same account.
   */
  stale: string[]
  /** Stale folders that already hold a sync lock. */
  active: string[]
  /** `accountId:folder` → timestamp of the last request sent by this client. */
  lastRequested: Record<string, number>
  now: number
  /** How many requests to emit at most. */
  limit?: number
  minAgeMs?: number
}

export function pickSyncRequests(input: SyncQueueInput): string[] {
  const limit = input.limit ?? 3
  const minAge = input.minAgeMs ?? 30_000
  const active = new Set(input.active)
  const picked: string[] = []
  for (const accountId of input.stale) {
    if (picked.length >= limit) {
      break
    }
    if (active.has(accountId)) {
      continue
    }
    const last = input.lastRequested[accountId] ?? 0
    if (input.now - last < minAge) {
      continue
    }
    picked.push(accountId)
  }
  return picked
}
