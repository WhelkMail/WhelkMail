import { describe, expect, it, vi } from 'vitest'
import { runSyncChain } from '../src/lib/sync-chain'

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
