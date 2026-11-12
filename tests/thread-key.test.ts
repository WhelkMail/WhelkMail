import { describe, expect, it } from 'vitest'
import {
  mergeThreadsBySubject,
  normalizeMessageId,
  normalizeSubject,
  referenceIds,
  threadKeyFor,
} from '../functions/_lib/mail/thread-key'

const base = { messageId: '<new@x.it>', inReplyTo: null, references: null, fallback: 'hash:1' }

describe('normalizeMessageId', () => {
  it('strips brackets, lowercases and takes the first id', () => {
    expect(normalizeMessageId('<ABC@X.it>')).toBe('abc@x.it')
    expect(normalizeMessageId('  <a@b.it> <c@d.it> ')).toBe('a@b.it')
    expect(normalizeMessageId(null)).toBe('')
    expect(normalizeMessageId('   ')).toBe('')
  })
})

describe('referenceIds', () => {
  it('keeps every id in order', () => {
    expect(referenceIds('<1@x> <2@x>  <3@x>')).toEqual(['1@x', '2@x', '3@x'])
    expect(referenceIds(undefined)).toEqual([])
  })
})

describe('threadKeyFor', () => {
  it('makes a message without headers its own thread', () => {
    expect(threadKeyFor(base)).toBe('new@x.it')
  })

  it('adopts the root of References', () => {
    expect(
      threadKeyFor({ ...base, references: '<root@x.it> <mid@x.it>', inReplyTo: '<mid@x.it>' }),
    ).toBe('root@x.it')
  })

  it('falls back to In-Reply-To when References is missing', () => {
    expect(threadKeyFor({ ...base, inReplyTo: '<root@x.it>' })).toBe('root@x.it')
  })

  it('prefers the key already stored for the parent (truncated chains)', () => {
    expect(
      threadKeyFor({
        ...base,
        inReplyTo: '<mid@x.it>',
        references: '<mid@x.it>',
        parentKey: 'root@x.it',
      }),
    ).toBe('root@x.it')
  })

  it('uses the stable fallback when the message has no Message-ID', () => {
    expect(threadKeyFor({ ...base, messageId: null })).toBe('hash:1')
    expect(threadKeyFor({ ...base, messageId: '', fallback: 'mid:abc' })).toBe('mid:abc')
  })
})

describe('normalizeSubject', () => {
  it('strips reply and forward prefixes, repeatedly', () => {
    expect(normalizeSubject('Re: Fattura 12')).toBe('fattura 12')
    expect(normalizeSubject('RE: Re[2]: Rif: Fattura 12')).toBe('fattura 12')
    expect(normalizeSubject('R:   Preventivo')).toBe('preventivo')
    expect(normalizeSubject('AW: Angebot')).toBe('angebot')
    expect(normalizeSubject('Fwd: I: Fattura 12')).toBe('fattura 12')
    expect(normalizeSubject('Fattura 12')).toBe('fattura 12')
  })

  it('collapses whitespace and handles empty input', () => {
    expect(normalizeSubject('  Fattura    12 ')).toBe('fattura 12')
    expect(normalizeSubject(null)).toBe('')
    expect(normalizeSubject('   ')).toBe('')
  })
})

describe('mergeThreadsBySubject', () => {
  it('puts replies without headers back into the conversation', () => {
    const rows = [
      { id: 'a', subject: 'Fattura 12', threadKey: 'mid-a@x', sentAt: '2026-01-01T10:00:00.000Z' },
      { id: 'b', subject: 'Re: Fattura 12', threadKey: null, sentAt: '2026-01-02T10:00:00.000Z' },
      { id: 'c', subject: 'R: Fattura 12', threadKey: 'mid-c@x', sentAt: '2026-01-03T10:00:00.000Z' },
    ]
    expect([...mergeThreadsBySubject(rows)]).toEqual([
      ['b', 'mid-a@x'],
      ['c', 'mid-a@x'],
    ])
  })

  it('leaves single messages and unrelated subjects alone', () => {
    const rows = [
      { id: 'a', subject: 'Fattura 12', threadKey: 'mid-a@x', sentAt: '2026-01-01T10:00:00.000Z' },
      { id: 'b', subject: 'Preventivo', threadKey: null, sentAt: '2026-01-02T10:00:00.000Z' },
      { id: 'c', subject: '', threadKey: null, sentAt: '2026-01-03T10:00:00.000Z' },
    ]
    expect(mergeThreadsBySubject(rows).size).toBe(0)
  })
})
