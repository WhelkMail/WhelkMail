import { describe, expect, it } from 'vitest'
import { pickSyncRequests } from '../src/lib/sync-queue'

const base = { now: 1_000_000, lastRequested: {}, limit: 3, minAgeMs: 30_000 }

describe('pickSyncRequests', () => {
  it('asks nothing when every stale account is already syncing', () => {
    expect(
      pickSyncRequests({ ...base, stale: ['a', 'b'], active: ['a', 'b'] }),
    ).toEqual([])
  })

  it('asks the stale accounts that are not locked', () => {
    expect(pickSyncRequests({ ...base, stale: ['a', 'b', 'c'], active: ['b'] })).toEqual([
      'a',
      'c',
    ])
  })

  it('rotates past the accounts asked recently instead of starving the rest', () => {
    // Round one: the first three.
    expect(pickSyncRequests({ ...base, stale: ['a', 'b', 'c', 'd', 'e'], active: [] })).toEqual([
      'a',
      'b',
      'c',
    ])
    // Round two: a, b, c were just asked, so d and e get their turn.
    expect(
      pickSyncRequests({
        ...base,
        stale: ['a', 'b', 'c', 'd', 'e'],
        active: [],
        lastRequested: { a: base.now - 1000, b: base.now - 1000, c: base.now - 1000 },
      }),
    ).toEqual(['d', 'e'])
  })

  it('respects the limit and the cooldown', () => {
    expect(
      pickSyncRequests({
        ...base,
        stale: ['a', 'b', 'c', 'd'],
        active: [],
        limit: 1,
      }),
    ).toEqual(['a'])
    expect(
      pickSyncRequests({
        ...base,
        stale: ['a'],
        active: [],
        lastRequested: { a: base.now - 1000 },
        minAgeMs: 60_000,
      }),
    ).toEqual([])
    expect(
      pickSyncRequests({
        ...base,
        stale: ['a'],
        active: [],
        lastRequested: { a: base.now - 60_000 },
        minAgeMs: 60_000,
      }),
    ).toEqual(['a'])
  })

  it('handles an empty or missing list', () => {
    expect(pickSyncRequests({ ...base, stale: [], active: [] })).toEqual([])
    expect(pickSyncRequests({ ...base, stale: [], active: ['a'] })).toEqual([])
  })
})
