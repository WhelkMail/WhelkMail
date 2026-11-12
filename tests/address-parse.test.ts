import { describe, expect, it } from 'vitest'
import { displayAddress, isValidEmail, parseAddresses } from '../src/lib/utils'

describe('parseAddresses', () => {
  it('accepts the Name <address> form inserted by the contact picker', () => {
    expect(parseAddresses('Mario <mia@email.it>')).toEqual(['mia@email.it'])
    expect(parseAddresses('Mario <mia@email.it>, ')).toEqual(['mia@email.it'])
    expect(isValidEmail(parseAddresses('Mario <mia@email.it>')[0])).toBe(true)
  })

  it('mixes plain addresses with display names and separators', () => {
    expect(parseAddresses('a@b.it, Mario <m@x.it>; c@d.it')).toEqual(['a@b.it', 'm@x.it', 'c@d.it'])
    expect(parseAddresses('  <m@x.it>  ')).toEqual(['m@x.it'])
  })

  it('keeps quoted names with commas in one entry', () => {
    expect(parseAddresses('"Rossi, Mario" <m@x.it>, b@c.it')).toEqual(['m@x.it', 'b@c.it'])
    expect(parseAddresses('"Rossi; Mario" <m@x.it>')).toEqual(['m@x.it'])
  })

  it('lowercases and drops empty entries', () => {
    expect(parseAddresses('Mario <MIA@Email.IT>, ,')).toEqual(['mia@email.it'])
    expect(parseAddresses('')).toEqual([])
    expect(parseAddresses('   ')).toEqual([])
  })

  it('still reports malformed input as invalid', () => {
    const parsed = parseAddresses('Mario <>')
    expect(parsed).toEqual([])
    expect(isValidEmail(parseAddresses('Mario')[0] ?? '')).toBe(false)
  })

  it('round-trips displayAddress output', () => {
    const address = { name: 'Mario Rossi', email: 'mia@email.it' }
    expect(parseAddresses(displayAddress(address))).toEqual([address.email])
    expect(parseAddresses(`x@y.it, ${displayAddress(address)}`)).toEqual(['x@y.it', address.email])
  })
})
