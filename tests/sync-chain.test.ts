import { describe, expect, it, vi } from 'vitest'
import { nextChainDelay, runSyncChain } from '../src/lib/sync-chain'

const noWait = async (): Promise<void> => undefined

describe('runSyncChain', () => {
  it('keeps asking until the folder is done, without a cron or a list refresh', async () => {
    const answers = [true, true, true, false]
    const run = vi.fn(async () => ({ hasMore: answers.shift() ?? false }))
    const result = await runSyncChain(run, { wait: noWait })
    expect(run).toHaveBeenCalledTimes(4)
    expect(result).toEqual({ chunks: 4, done: true, locked: false })
  })

  it('stops when another worker holds the lock instead of spinning', async () => {
    const run = vi.fn(async () => ({ hasMore: true, locked: true }))
    const result = await runSyncChain(run, { wait: noWait })
    expect(run).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ chunks: 1, done: false, locked: true })
  })

  it('stops on error and reports it', async () => {
    const run = vi.fn(async () => ({ hasMore: true, error: 'IMAP down' }))
    const result = await runSyncChain(run, { wait: noWait })
    expect(result).toMatchObject({ chunks: 1, done: false, error: 'IMAP down' })
  })

  it('gives up at the cap and leaves the rest to the next load', async () => {
    const run = vi.fn(async () => ({ hasMore: true }))
    const result = await runSyncChain(run, { wait: noWait, max: 3 })
    expect(run).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ chunks: 3, done: false })
  })

  it('pauses between chunks', async () => {
    const wait = vi.fn(async () => undefined)
    const answers = [true, false]
    await runSyncChain(async () => ({ hasMore: answers.shift() ?? false }), {
      wait,
      delayMs: 123,
    })
    expect(wait).toHaveBeenCalledWith(123)
  })
})

describe('nextChainDelay', () => {
  it('resumes after a cap, so a big mailbox keeps going', () => {
    expect(nextChainDelay({ chunks: 30, done: false, locked: false })).toBe(500)
    expect(nextChainDelay({ chunks: 30, done: false, locked: false }, { resumeMs: 1000 })).toBe(
      1000,
    )
  })

  it('backs off when another worker holds the lock', () => {
    expect(nextChainDelay({ chunks: 1, done: false, locked: true })).toBe(5000)
  })

  it('stops when the folder is done or failed', () => {
    expect(nextChainDelay({ chunks: 4, done: true, locked: false })).toBeNull()
    expect(nextChainDelay({ chunks: 1, done: false, locked: false, error: 'boom' })).toBeNull()
  })
})

describe('stall detection', () => {
  it('stops when the folder keeps reporting work but does not advance', async () => {
    // The archive write keeps failing: same synced count, hasMore forever.
    const run = vi.fn(async () => ({ hasMore: true, progress: 40 }))
    const result = await runSyncChain(run, { wait: noWait, stallLimit: 3 })
    expect(result).toMatchObject({ done: false, stalled: true })
    // The first chunk sets the baseline, then three chunks in a row without
    // progress stop the chain.
    expect(run.mock.calls.length).toBe(4)
  })

  it('keeps going while the synced count grows', async () => {
    let synced = 0
    const run = vi.fn(async () => {
      synced += 40
      return { hasMore: synced < 200, progress: synced }
    })
    const result = await runSyncChain(run, { wait: noWait, stallLimit: 3 })
    expect(result).toEqual({ chunks: 5, done: true, locked: false })
  })

  it('does not reschedule a stalled chain', () => {
    expect(
      nextChainDelay({ chunks: 3, done: false, locked: false, stalled: true }),
    ).toBeNull()
  })
})
