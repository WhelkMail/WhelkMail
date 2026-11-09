import { describe, expect, it } from 'vitest'
import type { MailFilter, MessageSummary } from '../shared/types'
import { matchesFilter } from '../functions/_lib/filters'

function makeFilter(overrides: Partial<MailFilter> = {}): MailFilter {
  return {
    id: 'filter-1',
    name: 'Test filter',
    from: null,
    to: null,
    subject: null,
    hasWords: null,
    doesntHave: null,
    hasAttachment: false,
    labelIds: [],
    forwardTo: [],
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastForwardStatus: null,
    lastForwardError: null,
    lastForwardAt: null,
    ...overrides,
  }
}

function makeMessage(overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: 'message-1',
    accountId: 'account-1',
    accountEmail: 'me@example.com',
    accountName: 'Me',
    folder: 'inbox',
    from: { name: 'Mario Rossi', email: 'mario@example.com' },
    to: [{ name: null, email: 'me@example.com' }],
    cc: [],
    bcc: [],
    subject: 'Fattura di novembre',
    snippet: 'Buongiorno, in allegato la fattura.',
    date: '2026-01-01T10:00:00.000Z',
    unread: false,
    hasAttachments: true,
    status: 'sent',
    labelIds: [],
    ...overrides,
  }
}

describe('matchesFilter', () => {
  it('matches sender, recipients, subject and words', () => {
    const filter = makeFilter({
      from: 'mario',
      to: 'me@example',
      subject: 'fattura',
      hasWords: 'allegato',
      doesntHave: 'spam',
    })
    expect(matchesFilter(filter, makeMessage())).toBe(true)
  })

  it('never matches messages outside the inbox', () => {
    expect(matchesFilter(makeFilter({ subject: 'fattura' }), makeMessage({ folder: 'sent' }))).toBe(
      false,
    )
  })

  it('requires all configured criteria', () => {
    expect(matchesFilter(makeFilter({ from: 'mario', subject: 'natale' }), makeMessage())).toBe(
      false,
    )
  })

  it('rejects messages containing the excluded words', () => {
    expect(matchesFilter(makeFilter({ doesntHave: 'allegato' }), makeMessage())).toBe(false)
  })

  it('checks attachments when requested', () => {
    expect(matchesFilter(makeFilter({ hasAttachment: true }), makeMessage())).toBe(true)
    expect(
      matchesFilter(makeFilter({ hasAttachment: true }), makeMessage({ hasAttachments: false })),
    ).toBe(false)
  })
})
