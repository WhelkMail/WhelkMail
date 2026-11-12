import { describe, expect, it } from 'vitest'
import { capFailures } from '../functions/_lib/storage/cleanup-log'
import { planAccountPurge } from '../functions/_lib/storage/purge-plan'
import { encodeImapPointer } from '../shared/relay-copy'

describe('planAccountPurge', () => {
  it('groups relay copies by the driver that wrote them', () => {
    const plan = planAccountPurge(
      [
        { driver: 'drive', key: 'sent/a.eml' },
        { driver: 'r2', key: 'accounts/x/sent/b.eml' },
        { driver: 'drive', key: 'drafts/c.eml' },
      ],
      [],
    )
    expect([...plan.copies.get('drive') ?? []]).toEqual(['sent/a.eml', 'drafts/c.eml'])
    expect([...plan.copies.get('r2') ?? []]).toEqual(['accounts/x/sent/b.eml'])
  })

  it('never deletes the copies kept in a mailbox', () => {
    const pointer = encodeImapPointer({ accountId: 'other', folder: 'Sent', uid: 7 })
    const plan = planAccountPurge([{ driver: 'imap', key: pointer }], [])
    expect(plan.copies.size).toBe(0)
  })

  it('removes a legacy archive from both backends when the driver is unknown', () => {
    const plan = planAccountPurge([], [{ driver: null, key: 'imap/a/inbox/1/inbox-1.eml' }])
    expect([...plan.archives.keys()].sort()).toEqual(['drive', 'r2'])
    expect([...plan.archives.get('drive') ?? []]).toEqual(['imap/a/inbox/1/inbox-1.eml'])
    expect([...plan.archives.get('r2') ?? []]).toEqual(['imap/a/inbox/1/inbox-1.eml'])
  })

  it('trusts the recorded archive driver', () => {
    const plan = planAccountPurge(
      [],
      [
        { driver: 'drive', key: 'imap/a/sent/1/sent-1.eml' },
        { driver: 'r2', key: 'imap/a/sent/1/sent-2.eml' },
      ],
    )
    expect([...plan.archives.get('drive') ?? []]).toEqual(['imap/a/sent/1/sent-1.eml'])
    expect([...plan.archives.get('r2') ?? []]).toEqual(['imap/a/sent/1/sent-2.eml'])
  })

  it('ignores empty rows', () => {
    const plan = planAccountPurge(
      [{ driver: 'drive', key: null }, { driver: null, key: 'sent/a.eml' }],
      [{ driver: 'r2', key: null }],
    )
    expect(plan.copies.size).toBe(0)
    expect(plan.archives.size).toBe(0)
  })
})

describe('capFailures', () => {
  it('keeps one entry per object, most recent order preserved, capped', () => {
    const failures = [
      { driver: 'drive', key: 'sent/a.eml', error: 'boom' },
      { driver: 'drive', key: 'sent/a.eml', error: 'boom again' },
      { driver: 'r2', key: 'accounts/x/sent/b.eml', error: 'nope' },
      { driver: 'drive', key: '', error: 'ignored' },
    ]
    expect(capFailures(failures)).toEqual([
      { driver: 'drive', key: 'sent/a.eml', error: 'boom' },
      { driver: 'r2', key: 'accounts/x/sent/b.eml', error: 'nope' },
    ])
  })

  it('stops at the limit', () => {
    const failures = Array.from({ length: 80 }, (_, index) => ({
      driver: 'r2',
      key: `accounts/x/sent/${index}.eml`,
      error: 'e',
    }))
    expect(capFailures(failures, 50)).toHaveLength(50)
    expect(capFailures([], 50)).toEqual([])
  })
})
