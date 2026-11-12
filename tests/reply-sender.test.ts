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

  it('answers from the alias the message was sent to, when nothing is configured', () => {
    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: null,
        aliasAccountId: 'domain-relay',
        defaultSender: 'auto',
        accountIds: ids,
      }),
    ).toBe('domain-relay')
  })

  it('keeps the explicit mapping above the alias and the alias above the preference', () => {
    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: 'other',
        aliasAccountId: 'domain-relay',
        defaultSender: 'other',
        accountIds: ids,
      }),
    ).toBe('other')

    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: null,
        aliasAccountId: 'domain-relay',
        defaultSender: 'other',
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

describe('alias detection inputs', () => {
  it('matches the domain account from the recipients of a forwarded message', () => {
    // Mirrors aliasAccountFor() in App: To/Cc plus the forwarding headers.
    const domain = { id: 'domain-relay', email: 'email@dominio.it' }
    const provider = { id: 'provider', email: 'email@provider.it' }
    const accounts = [provider, domain]
    const message = {
      accountId: 'provider',
      aliasAddresses: ['email@dominio.it'],
      to: [{ email: 'email@provider.it' }],
      cc: [],
    }
    const addresses = new Set(
      [
        ...message.aliasAddresses,
        ...message.to.map((item) => item.email),
        ...message.cc.map((item) => item.email),
      ].map((email) => email.toLowerCase()),
    )
    const match = accounts.find(
      (item) => item.id !== message.accountId && addresses.has(item.email.toLowerCase()),
    )
    expect(match?.id).toBe('domain-relay')
  })
})
