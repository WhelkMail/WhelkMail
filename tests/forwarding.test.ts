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

  it('reads header.d and drops the version and a trailing dot', () => {
    const parsed = parseAuthResults('mx.cloudflare.net 1; dkim=pass header.d=Mydomain.Example. header.s=s1')
    expect(parsed.authservId).toBe('mx.cloudflare.net')
    expect(dkimDomain(parsed.results[0])).toBe('mydomain.example')
  })
})
