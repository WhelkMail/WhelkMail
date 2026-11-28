import { describe, expect, it } from 'vitest'
import { dkimDomain, parseAuthResults, parseReceived } from '../functions/_lib/mail/forwarding/headers'

describe('parseReceived', () => {
  it("reads the receiving server's record of the peer, not the HELO name", () => {
    expect(
      parseReceived(
        'from ba-ee.cloudflare-email.net (ba-ee.cloudflare-email.net. [104.30.10.44])        by mx.google.com with ESMTPS id ffacd0b85a97d-4a65821be0csi1006696f8f.205.2026.11.17.13.39.31        for <me@gmail.example>        (version=TLS1_3 cipher=TLS_AES_128_GCM_SHA256 bits=128/128);        Tue, 17 Nov 2026 13:39:31 -0800 (PST)',
      ),
    ).toEqual({
      helo: 'ba-ee.cloudflare-email.net',
      host: 'ba-ee.cloudflare-email.net',
      ip: '104.30.10.44',
      by: 'mx.google.com',
      for: 'me@gmail.example',
    })
  })

  it('keeps a forged HELO apart from the recorded host', () => {
    const received = parseReceived(
      'from i-ba.cloudflare-email.net (mail.attacker.example [198.51.100.7]) by mx.example with ESMTPS; Tue, 17 Nov 2026 13:39:31 -0800',
    )
    expect(received.helo).toBe('i-ba.cloudflare-email.net')
    expect(received.host).toBe('mail.attacker.example')
    expect(received.ip).toBe('198.51.100.7')
  })

  it('reads a bare IP, an unknown host and IPv6', () => {
    expect(
      parseReceived(
        'from bg-bag.cloudflare-smtp.net (104.30.16.106)        by cloudflare-email.net (cloudflare) id mEGiICPPdocG        for <test@otherdomain.example>; Tue, 17 Nov 2026 21:39:30 +0000',
      ),
    ).toEqual({
      helo: 'bg-bag.cloudflare-smtp.net',
      host: null,
      ip: '104.30.16.106',
      by: 'cloudflare-email.net',
      for: 'test@otherdomain.example',
    })
    expect(parseReceived('from helo.example (unknown [192.0.2.1]) by mx.example; date').host).toBeNull()
    expect(parseReceived('from helo.example (host.example [IPv6:2001:db8::1]) by mx.example; date').ip).toBe('2001:db8::1')
  })

  it("ignores by and for clauses inside comments and quoted strings", () => {
    // Exim records the sender's HELO in the comment, so nothing after helo= is a lookup.
    expect(
      parseReceived('from [198.51.100.7] (helo=x by evil.example for <forged@mydomain.example>) by mx.example (Postfix "by evil2.example") with ESMTPS id abc for <me@inbox.example>; date'),
    ).toEqual({ helo: '[198.51.100.7]', host: null, ip: null, by: 'mx.example', for: 'me@inbox.example' })
  })

  it('reads the recorded host from a comment with nested comments and escapes', () => {
    expect(
      parseReceived('from helo.example (host.example (nested \\) text) [192.0.2.1]) by mx.example; date'),
    ).toMatchObject({ helo: 'helo.example', host: 'host.example', ip: '192.0.2.1', by: 'mx.example' })
  })

  it("doesn't read a for clause from inside a quoted string", () => {
    expect(
      parseReceived('from helo.example (peer.example [192.0.2.1]) by mx.example with SMTP id "abc for <forged@example.org>" for <real@example.org>; date'),
    ).toMatchObject({ by: 'mx.example', for: 'real@example.org' })
    expect(parseReceived('from helo.example (peer.example [192.0.2.1]) by mx.example for <"a b"@example.org>; date').for).toBe('a b@example.org')
  })

  it('returns only valid IP addresses', () => {
    const ipOf = (literal: string) => parseReceived(`from helo.example (host.example ${literal}) by mx.example; date`).ip
    for (const invalid of ['[999.999.999.999]', '[256.1.1.1]', '[01.2.3.4]', '[1.2.3]', '[::::]', '[1::2::3]', '[12345::1]', '[1:2:3:4:5:6:7:8:9]', '[::ffff:999.1.1.1]', '999.999.999.999', '::::']) {
      expect(ipOf(invalid), invalid).toBeNull()
    }
    for (const [literal, ip] of [
      ['[192.0.2.1]', '192.0.2.1'],
      ['[0.0.0.0]', '0.0.0.0'],
      ['[IPv6:2001:DB8::1]', '2001:db8::1'],
      ['[2001:db8:0:0:0:0:0:1]', '2001:db8:0:0:0:0:0:1'],
      ['[::1]', '::1'],
      ['[::ffff:192.0.2.1]', '::ffff:192.0.2.1'],
      ['192.0.2.1', '192.0.2.1'],
    ]) {
      expect(ipOf(literal), literal).toBe(ip)
    }
  })

  it("doesn't read an invalid IP as the host", () => {
    expect(parseReceived('from helo.example (999.999.999.999) by mx.example; date')).toMatchObject({ host: null, ip: null })
  })

  it('reads a hop with no from clause', () => {
    expect(parseReceived('by 2002:a05:7108:63a1:b0:62f:c5fe:dec5 with SMTP id a1csp2206408gdr;        Tue, 17 Nov 2026 13:39:32 -0800 (PST)')).toEqual({
      helo: null,
      host: null,
      ip: null,
      by: '2002:a05:7108:63a1:b0:62f:c5fe:dec5',
      for: null,
    })
  })
})

describe('parseAuthResults', () => {
  const header =
    'mx.google.com;       dkim=pass header.i=@otherdomain.example header.s=cf2024-1 header.b=Nl+AXXL4;       dkim=pass header.i=@cloudflare-email.net header.s=cf2024-1 header.b="V/sqBhng";       spf=pass (google.com: domain of cfbounces+ndrdrop@otherdomain.example designates 104.30.10.44 as permitted sender) smtp.mailfrom=cfbounces+ndrdrop@otherdomain.example;       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=notifications.mydomain.example'

  it('splits the results and their properties', () => {
    const parsed = parseAuthResults(header)
    expect(parsed.authservId).toBe('mx.google.com')
    expect(parsed.results.map((result) => `${result.method}=${result.result}`)).toEqual([
      'dkim=pass',
      'dkim=pass',
      'spf=pass',
      'dmarc=pass',
    ])
    expect(parsed.results[0].props).toEqual({
      'header.i': '@otherdomain.example',
      'header.s': 'cf2024-1',
      'header.b': 'Nl+AXXL4',
    })
    expect(parsed.results[1].props['header.b']).toBe('V/sqBhng')
    expect(parsed.results[2].props['smtp.mailfrom']).toBe('cfbounces+ndrdrop@otherdomain.example')
    expect(dkimDomain(parsed.results[0])).toBe('otherdomain.example')
  })

  it("doesn't let a comment add a result or a property", () => {
    const parsed = parseAuthResults('mx.example; spf=fail (dkim=pass header.d=mydomain.example; smtp.mailfrom=x@mydomain.example) smtp.mailfrom=x@attacker.example')
    expect(parsed.results).toEqual([{ method: 'spf', result: 'fail', props: { 'smtp.mailfrom': 'x@attacker.example' } }])
  })

  it('keeps a semicolon inside a quoted value', () => {
    const parsed = parseAuthResults('mx.example; dkim=pass header.d=example.org header.foo="a;b"; spf=pass smtp.mailfrom=x@example.org')
    expect(parsed.results.map((result) => result.method)).toEqual(['dkim', 'spf'])
    expect(parsed.results[0].props['header.foo']).toBe('a;b')
  })

  it("can't be given a result by a sender's quoted local part", () => {
    // The sender chooses the envelope sender, and a quoted local part may hold
    // a semicolon, parentheses and text that looks like a result.
    const parsed = parseAuthResults(
      'mx.example; spf=pass smtp.mailfrom="x;dkim=pass header.d=mydomain.example (y)"@attacker.example; dkim=pass header.d=attacker.example',
    )
    expect(parsed.results.map((result) => `${result.method}=${result.result} ${dkimDomain(result) ?? ''}`.trim())).toEqual([
      'spf=pass',
      'dkim=pass attacker.example',
    ])
    expect(parsed.results[0].props['smtp.mailfrom']).toBe('x;dkim=pass header.d=mydomain.example (y)@attacker.example')
  })

  it("doesn't read a property from inside a quoted value", () => {
    const parsed = parseAuthResults('mx.example; dkim=fail reason="signature mismatch header.d=mydomain.example" header.d=attacker.example')
    expect(dkimDomain(parsed.results[0])).toBe('attacker.example')
  })

  it('unescapes quoted values and keeps parentheses inside them', () => {
    const parsed = parseAuthResults('mx.example; dkim=pass header.d=example.org header.foo="a \\"(b)\\" c"')
    expect(parsed.results[0].props['header.foo']).toBe('a "(b)" c')
  })

  it('reads results and values with comments where whitespace may go', () => {
    const parsed = parseAuthResults('mx.example (v1); (checked) dkim=pass header.d=(domain) example.org (ok) header.s=s1')
    expect(parsed.authservId).toBe('mx.example')
    expect(parsed.results).toEqual([{ method: 'dkim', result: 'pass', props: { 'header.d': 'example.org', 'header.s': 's1' } }])
  })

  it('keeps the domain after a quoted local part', () => {
    const parsed = parseAuthResults('mx.example; dkim=pass header.i="user"@example.org')
    expect(parsed.results[0].props['header.i']).toBe('user@example.org')
    expect(dkimDomain(parsed.results[0])).toBe('example.org')
  })

  it('keeps whitespace inside a quoted value', () => {
    const parsed = parseAuthResults('mx.example;   spf=pass   smtp.mailfrom="a  b"@example.org')
    expect(parsed.results[0].props['smtp.mailfrom']).toBe('a  b@example.org')
    expect(parseReceived('from helo.example (peer.example [192.0.2.1]) by mx.example for <"a  b"@example.org>; date').for).toBe('a  b@example.org')
  })

  it('gives no DKIM domain for an identity split by whitespace or a comment', () => {
    for (const value of [
      'mx.example; dkim=pass header.i=mydomain.example @ attacker.example',
      'mx.example; dkim=pass header.i=user @ example.org',
      'mx.example; dkim=pass header.i=user@(comment)example.org',
    ]) {
      expect(dkimDomain(parseAuthResults(value).results[0])).toBeNull()
    }
  })

  it('accepts a method version', () => {
    const parsed = parseAuthResults('mx.example; dkim/1=pass header.d=example.org; spf / 1 = fail smtp.mailfrom=x@example.org')
    expect(parsed.results.map((result) => `${result.method}=${result.result}`)).toEqual(['dkim=pass', 'spf=fail'])
    expect(dkimDomain(parsed.results[0])).toBe('example.org')
  })

  it('reads header.d and drops the version and a trailing dot', () => {
    const parsed = parseAuthResults('mx.cloudflare.net 1; dkim=pass header.d=Mydomain.Example. header.s=s1')
    expect(parsed.authservId).toBe('mx.cloudflare.net')
    expect(dkimDomain(parsed.results[0])).toBe('mydomain.example')
  })
})
