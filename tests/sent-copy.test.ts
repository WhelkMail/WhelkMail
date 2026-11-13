import { describe, expect, it } from 'vitest'
import { resolveSentCopyTarget } from '../src/lib/sent-copy'

const alice = { id: 'imap-alice' }
const bob = { id: 'imap-bob' }

describe('sent copy target', () => {
  it('preselects the only IMAP mailbox when nothing is chosen yet', () => {
    expect(resolveSentCopyTarget('', [alice])).toBe('imap-alice')
  })

  it('preselects the first mailbox when several are available', () => {
    expect(resolveSentCopyTarget('', [alice, bob])).toBe('imap-alice')
  })

  it('keeps a valid choice so the user can pick another mailbox', () => {
    expect(resolveSentCopyTarget('imap-bob', [alice, bob])).toBe('imap-bob')
  })

  it('replaces a stale choice with an available mailbox', () => {
    // The stored account was deleted or disconnected: returning it would send an
    // id the backend rejects, leaving an empty dropdown on screen.
    expect(resolveSentCopyTarget('imap-gone', [alice, bob])).toBe('imap-alice')
  })

  it('returns nothing when there is no IMAP mailbox', () => {
    expect(resolveSentCopyTarget('', [])).toBe('')
    expect(resolveSentCopyTarget('imap-gone', [])).toBe('')
  })

  it('handles a missing current value', () => {
    expect(resolveSentCopyTarget(null, [alice])).toBe('imap-alice')
    expect(resolveSentCopyTarget(undefined, [alice])).toBe('imap-alice')
  })
})
