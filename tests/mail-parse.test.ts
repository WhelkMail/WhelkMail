import { describe, expect, it } from 'vitest'
import { bodyText, dateOf, parseHeaders, toMailbox, toMailboxes } from '../functions/_lib/mail/parse'

describe('mail parsing', () => {
  it('parses common headers', async () => {
    const email = await parseHeaders(
      [
        'From: Mario Rossi <mario@example.com>',
        'To: Anna <anna@example.com>, me@example.com',
        'Subject: Ciao',
        'Date: Wed, 01 Jan 2026 10:00:00 +0000',
        'Message-ID: <abc@example.com>',
      ].join('\r\n'),
    )
    expect(email.subject).toBe('Ciao')
    expect(email.messageId).toBe('<abc@example.com>')
    expect(toMailbox(email.from)).toEqual({ name: 'Mario Rossi', email: 'mario@example.com' })
    expect(toMailboxes(email.to)).toEqual([
      { name: 'Anna', email: 'anna@example.com' },
      { name: null, email: 'me@example.com' },
    ])
    expect(dateOf(email)).toBe('2026-01-01T10:00:00.000Z')
  })

  it('falls back to a plain text version of HTML', async () => {
    const email = await parseHeaders(
      [
        'From: mario@example.com',
        'Subject: HTML',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>Prima riga</p><p>Seconda riga</p>',
      ].join('\r\n'),
    )
    expect(bodyText(email)).toContain('Prima riga')
    expect(bodyText(email)).toContain('Seconda riga')
    expect(bodyText(email)).not.toContain('<p>')
  })
})
