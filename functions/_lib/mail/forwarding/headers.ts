/**
 * Structured views of the trace headers that receiving servers and forwarders
 * write. They only split a header into its parts: which header to read, and
 * whether its parts can be trusted, is up to the receiver and forwarder rules
 * in `./index.ts`.
 */

export interface ReceivedHeader {
  /**
   * Name the connecting server gave itself (HELO/EHLO). The sender chooses it,
   * so it must never be used to decide who sent the message.
   */
  helo: string | null
  /**
   * Reverse DNS name of the connecting server, as the server that wrote the
   * header looked it up. Null when it recorded none ("unknown").
   */
  host: string | null
  /** IP address of the connecting server, as the server that wrote the header saw it. */
  ip: string | null
  /** Server that wrote the header (the `by` clause). */
  by: string | null
  /** Recipient the message was received for (the `for` clause). */
  for: string | null
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/
const IPV6 = /^(?:ipv6:)?[0-9a-f]*:[0-9a-f:.]+$/i
const HOSTNAME = /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)+\.?$/i

const isIp = (token: string): boolean => IPV4.test(token) || IPV6.test(token)
const stripIpv6Prefix = (ip: string): string => ip.replace(/^ipv6:/i, '')

/**
 * Splits a `Received` header, such as
 * `from helo.example (host.example. [192.0.2.1]) by mx.example with ESMTPS id … for <me@example>; <date>`.
 *
 * The comment after the HELO name is where the receiving server records what
 * it saw: the reverse DNS name and the IP, in brackets or bare.
 */
export function parseReceived(value: string): ReceivedHeader {
  const text = value.replace(/\s+/g, ' ').trim()
  const from = text.match(/^from\s+(\S+)(?:\s+\(([^)]*)\))?/i)
  const helo = from?.[1] ?? null
  const comment = from?.[2] ?? ''

  let ip: string | null = comment.match(/\[([0-9a-f:.]+|ipv6:[0-9a-f:.]+)\]/i)?.[1] ?? null
  let host: string | null = null
  for (const token of comment.replace(/\[[^\]]*\]/g, ' ').split(/[\s,]+/).filter(Boolean)) {
    if (isIp(token)) {
      ip ??= token
    } else if (!host && HOSTNAME.test(token) && !/^helo=/i.test(token)) {
      host = token.replace(/\.$/, '').toLowerCase()
    }
  }

  // The by and for clauses come after the from clause and its comment.
  const rest = from ? text.slice(from[0].length) : text
  const by = rest.match(/(?:^|\s)by\s+([^\s;()]+)/i)?.[1]?.toLowerCase() ?? null
  const forAddress = rest.match(/(?:^|\s)for\s+<?([^\s<>;]+@[^\s<>;]+)>?/i)?.[1]?.toLowerCase() ?? null

  return {
    helo,
    host,
    ip: ip ? stripIpv6Prefix(ip).toLowerCase() : null,
    by,
    for: forAddress,
  }
}

export interface AuthResult {
  /** Method, such as `dkim`, `spf` or `dmarc`. */
  method: string
  /** Result, such as `pass` or `fail`. */
  result: string
  /** Properties such as `header.d`, `header.i`, `header.s` or `smtp.mailfrom`, keys lower-cased. */
  props: Record<string, string>
}

export interface AuthResults {
  /** Server that wrote the header, from its authserv-id. */
  authservId: string
  results: AuthResult[]
}

/**
 * Splits an `Authentication-Results` header (RFC 8601), such as
 * `mx.example; dkim=pass header.i=@example.org header.s=s1; spf=pass smtp.mailfrom=a@example.org`.
 *
 * Comments in parentheses are dropped first, so a comment can't add a result
 * or a property.
 */
export function parseAuthResults(value: string): AuthResults {
  let text = value.replace(/\s+/g, ' ')
  // Comments may nest; strip the innermost until none remain.
  for (let previous = ''; previous !== text; ) {
    previous = text
    text = text.replace(/\([^()]*\)/g, ' ')
  }
  const [head = '', ...parts] = text.split(';')
  const authservId = head.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const results: AuthResult[] = []
  for (const part of parts) {
    const verdict = part.match(/^\s*([a-z0-9_-]+)\s*=\s*([a-z0-9_-]+)/i)
    if (!verdict) {
      continue
    }
    const props: Record<string, string> = {}
    for (const prop of part.slice(verdict[0].length).matchAll(/([a-z0-9_-]+\.[a-z0-9_.-]+)\s*=\s*("[^"]*"|[^\s;]+)/gi)) {
      props[prop[1].toLowerCase()] = prop[2].replace(/^"|"$/g, '')
    }
    results.push({ method: verdict[1].toLowerCase(), result: verdict[2].toLowerCase(), props })
  }
  return { authservId, results }
}

/**
 * Domain a DKIM result is for: `header.d`, or the domain of `header.i`. Lower
 * case, without a trailing dot.
 */
export function dkimDomain(result: AuthResult): string | null {
  const domain = result.props['header.d'] ?? result.props['header.i']?.split('@').pop() ?? null
  return domain ? domain.toLowerCase().replace(/\.$/, '') : null
}
