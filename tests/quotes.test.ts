import { describe, expect, it } from 'vitest'
import { splitQuotedText } from '../src/lib/quotes'

describe('splitQuotedText', () => {
  it('hides the quoted original of a reply written in the app', () => {
    const text = [
      'Grazie, lo annoto subito.',
      '',
      'On 10/11/2026, 16:30, Mario Grasso <mario@example.it> wrote:',
      '> Ciao. Ti invio il mio nuovo indirizzo email.',
    ].join('\n')
    expect(splitQuotedText(text)).toEqual({
      body: 'Grazie, lo annoto subito.',
      quote: 'On 10/11/2026, 16:30, Mario Grasso <mario@example.it> wrote:\n> Ciao. Ti invio il mio nuovo indirizzo email.',
    })
  })

  it('understands the Italian intro and the original-message separator', () => {
    const italian = 'Ok.\n\nIl giorno mar 10 nov 2026 alle ore 16:30 Mario ha scritto:\n> ciao'
    expect(splitQuotedText(italian)?.body).toBe('Ok.')

    const separator = 'Ricevuto.\n\n-----Original Message-----\nFrom: x'
    expect(splitQuotedText(separator)?.body).toBe('Ricevuto.')
  })

  it('falls back to the first quoted line', () => {
    expect(splitQuotedText('Va bene.\n> messaggio precedente')).toEqual({
      body: 'Va bene.',
      quote: '> messaggio precedente',
    })
  })

  it('leaves normal messages alone', () => {
    expect(splitQuotedText('Buongiorno, nessuna citazione qui.')).toBeNull()
    expect(splitQuotedText('')).toBeNull()
    expect(splitQuotedText('> solo una citazione')).toBeNull()
  })
})
