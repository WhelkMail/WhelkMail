import { describe, expect, it } from 'vitest'
import { draftMirrorIdsFromPointers, imapMessageId } from '../functions/_lib/mail/ids'
import { encodeImapPointer } from '../shared/relay-copy'

describe('draft mirror ids', () => {
  it('maps a mailbox pointer to the id of the mirrored draft', () => {
    const key = encodeImapPointer({ accountId: 'acct-1', folder: 'INBOX.Drafts', uid: 42 })
    expect(draftMirrorIdsFromPointers([key])).toEqual([imapMessageId('acct-1', 'draft', 42)])
  })

  it('keeps the order and skips object storage keys and junk', () => {
    const first = encodeImapPointer({ accountId: 'a', folder: 'Bozze', uid: 7 })
    const second = encodeImapPointer({ accountId: 'b', folder: 'Drafts', uid: 9 })
    expect(
      draftMirrorIdsFromPointers([
        'drafts/0f5c.eml',
        first,
        null,
        undefined,
        'imap:broken',
        'accounts/abc/drafts/0f5c.eml',
        second,
      ]),
    ).toEqual([
      imapMessageId('a', 'draft', 7),
      imapMessageId('b', 'draft', 9),
    ])
  })

  it('produces ids the app can address as IMAP drafts of that account', () => {
    const key = encodeImapPointer({ accountId: 'acct-2', folder: 'Drafts', uid: 5 })
    const [id] = draftMirrorIdsFromPointers([key])
    expect(id.startsWith('i_acct-2.')).toBe(true)
    expect(id.endsWith('.5')).toBe(true)
    expect(id).not.toBe(imapMessageId('acct-2', 'sent', 5))
  })
})
