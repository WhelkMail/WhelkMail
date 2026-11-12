import { describe, expect, it } from 'vitest'
import { pickReplySender } from '../src/lib/sender'

const ids = ['provider', 'domain-relay', 'other']

describe('pickReplySender', () => {
  it('uses the account configured on the mailbox that received the message', () => {
    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: 'domain-relay',
        defaultSender: 'auto',
        accountIds: ids,
      }),
    ).toBe('domain-relay')
  })

  it('beats the global reply preference', () => {
    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: 'domain-relay',
        defaultSender: 'other',
        accountIds: ids,
      }),
    ).toBe('domain-relay')
  })

  it('falls back to the global preference, then to the receiving account', () => {
    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: null,
        defaultSender: 'other',
        accountIds: ids,
      }),
    ).toBe('other')

    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: null,
        defaultSender: 'auto',
        accountIds: ids,
      }),
    ).toBe('provider')
  })

  it('ignores mappings that point at a deleted account', () => {
    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: 'gone',
        defaultSender: 'auto',
        accountIds: ids,
      }),
    ).toBe('provider')
    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: 'gone',
        defaultSender: 'gone-too',
        accountIds: ids,
      }),
    ).toBe('provider')
  })
})
