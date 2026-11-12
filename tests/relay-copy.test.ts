import { describe, expect, it } from 'vitest'
import { encodeImapPointer, parseImapPointer } from '../shared/relay-copy'

describe('imap copy pointer', () => {
  it('round-trips folders with spaces, dots and colons', () => {
    const pointer = { accountId: '3f1b9c88-1f6a-4a3e-9f4d-7c1f0a2b3c4d', folder: 'INBOX.Sent Items', uid: 812 }
    const key = encodeImapPointer(pointer)
    expect(key).toBe('imap:3f1b9c88-1f6a-4a3e-9f4d-7c1f0a2b3c4d:INBOX.Sent%20Items:812')
    expect(parseImapPointer(key)).toEqual(pointer)

    const colon = { accountId: 'acct', folder: 'Folder:Sub', uid: 1 }
    expect(parseImapPointer(encodeImapPointer(colon))).toEqual(colon)
  })

  it('ignores object-storage keys and malformed pointers', () => {
    expect(parseImapPointer('sent/abc.eml')).toBeNull()
    expect(parseImapPointer(' accounts/1/sent/abc.eml ')).toBeNull()
    expect(parseImapPointer('')).toBeNull()
    expect(parseImapPointer(null)).toBeNull()
    expect(parseImapPointer('imap:acct:Sent')).toBeNull()
    expect(parseImapPointer('imap:acct:Sent:notanumber')).toBeNull()
    expect(parseImapPointer('imap:acct:Sent:0')).toBeNull()
    expect(parseImapPointer('imap:acct:Sent:-3')).toBeNull()
    expect(parseImapPointer('imap::Sent:12')).toBeNull()
    expect(parseImapPointer('imap:acct:Sent:12:extra')).toBeNull()
  })
})
