import { describe, expect, it } from 'vitest'
import {
  advanceSyncWindow,
  isBackfillComplete,
  shouldResetOnUidValidity,
  shouldResumeBackfill,
} from '../functions/_lib/sync-plan'

describe('UIDVALIDITY handling', () => {
  it('resets the mirror when the provider renumbers the mailbox', () => {
    expect(shouldResetOnUidValidity(1000, 1001)).toBe(true)
  })

  it('keeps the mirror when the value is unchanged', () => {
    expect(shouldResetOnUidValidity(1000, 1000)).toBe(false)
  })

  it('does not reset on a first sync or unknown values', () => {
    expect(shouldResetOnUidValidity(null, 1000)).toBe(false)
    expect(shouldResetOnUidValidity(1000, null)).toBe(false)
    expect(shouldResetOnUidValidity(0, 0)).toBe(false)
  })
})

describe('backfill resume', () => {
  it('resumes when the mirror holds fewer messages than the provider', () => {
    expect(shouldResumeBackfill({ backfill_done: 1, synced: 120 }, 400)).toBe(true)
  })

  it('stays done when the counts match', () => {
    expect(shouldResumeBackfill({ backfill_done: 1, synced: 400 }, 400)).toBe(false)
  })

  it('ignores a backfill that was never marked done', () => {
    expect(shouldResumeBackfill({ backfill_done: 0, synced: 10 }, 400)).toBe(false)
  })

  it('does nothing without a row or a provider count', () => {
    expect(shouldResumeBackfill(null, 400)).toBe(false)
    expect(shouldResumeBackfill({ backfill_done: 1, synced: 10 }, null)).toBe(false)
  })
})

describe('UID window', () => {
  it('bootstraps both bounds from the first chunk', () => {
    expect(advanceSyncWindow({ maxUid: 0, minUid: 0 }, [980, 1010, 999], 'new')).toEqual({
      maxUid: 1010,
      minUid: 980,
    })
  })

  it('lowers minUid and keeps maxUid during a backfill window', () => {
    expect(advanceSyncWindow({ maxUid: 1010, minUid: 980 }, [900, 920], 'backfill')).toEqual({
      maxUid: 1010,
      minUid: 900,
    })
  })

  it('extends maxUid when new mail arrives', () => {
    expect(advanceSyncWindow({ maxUid: 1010, minUid: 900 }, [1011, 1015], 'new')).toEqual({
      maxUid: 1015,
      minUid: 900,
    })
  })

  it('is a no-op for an idle chunk', () => {
    expect(advanceSyncWindow({ maxUid: 1010, minUid: 900 }, [1, 2], 'idle')).toEqual({
      maxUid: 1010,
      minUid: 900,
    })
  })
})

describe('backfill completion', () => {
  it('is done when the provider has nothing older than the mirror', () => {
    expect(isBackfillComplete({ exists: 400, minUid: 5, lowestUid: 5 })).toBe(true)
    expect(isBackfillComplete({ exists: 400, minUid: 5, lowestUid: 9 })).toBe(true)
  })

  it('has more work when the provider holds older UIDs', () => {
    expect(isBackfillComplete({ exists: 400, minUid: 40, lowestUid: 1 })).toBe(false)
  })

  it('is done for an empty mailbox or a single-digit window', () => {
    expect(isBackfillComplete({ exists: 0, minUid: 40, lowestUid: null })).toBe(true)
    expect(isBackfillComplete({ exists: 400, minUid: 1, lowestUid: 1 })).toBe(true)
  })

  it('keeps the backfill open when the lowest UID cannot be read', () => {
    expect(isBackfillComplete({ exists: 400, minUid: 40, lowestUid: null })).toBe(false)
  })
})
