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

// Placeholders for comments and quoted strings, which can't occur in the text
// itself: lex() removes these characters from the input first.
const COMMENT = '\uE000'
const QUOTED = '\uE001'
const PLACEHOLDER = /[\uE000\uE001](\d+)[\uE000\uE001]/g

interface Lexed {
  /** The header with each comment and quoted string replaced by a placeholder. */
  text: string
  /** Text of each top-level comment, nested comments included. */
  comments: string[]
  /** Content of each quoted string, unescaped. */
  quoted: string[]
}

/**
 * Reads a structured header once, honouring quoted strings, backslash escapes
 * and nested comments (RFC 5322), and sets each comment and quoted string aside
 * behind a placeholder. Separators, `key=value` pairs and keywords are then
 * only ever found in the header's own structure: a `;`, `(` or `by` inside a
 * quoted value or a comment can't split a result or add a clause. An
 * unterminated quoted string or comment runs to the end of the header.
 */
function lex(value: string): Lexed {
  const input = value.replace(/[\uE000\uE001]/g, '').replace(/\s+/g, ' ')
  const comments: string[] = []
  const quoted: string[] = []
  let text = ''
  let depth = 0
  let comment = ''
  let quote: string | null = null
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quote !== null) {
      if (char === '\\' && i + 1 < input.length) {
        quote += input[++i]
      } else if (char === '"') {
        text += `${QUOTED}${quoted.push(quote) - 1}${QUOTED}`
        quote = null
      } else {
        quote += char
      }
    } else if (depth > 0) {
      if (char === '\\' && i + 1 < input.length) {
        comment += input[++i]
      } else if (char === '(') {
        depth++
        comment += char
      } else if (char === ')') {
        depth--
        if (depth === 0) {
          text += ` ${COMMENT}${comments.push(comment) - 1}${COMMENT} `
          comment = ''
        } else {
          comment += char
        }
      } else {
        comment += char
      }
    } else if (char === '"') {
      quote = ''
    } else if (char === '(') {
      depth = 1
    } else {
      text += char
    }
  }
  if (quote !== null) {
    text += `${QUOTED}${quoted.push(quote) - 1}${QUOTED}`
  }
  if (depth > 0) {
    text += ` ${COMMENT}${comments.push(comment) - 1}${COMMENT} `
  }
  return { text, comments, quoted }
}

/**
 * `text` with each comment replaced by a space, as RFC 5322 allows a comment
 * anywhere whitespace may go. Quoted strings stay placeholders, so keywords and
 * separators are still only found outside them.
 */
const dropComments = (text: string): string => text.replace(/\uE000\d+\uE000/g, ' ')

// One token: a run of quoted-string placeholders and other characters, so a
// quoted local part keeps its domain (`"user"@example.org`).
const TOKEN = '(?:\uE001\\d+\uE001|[^\\s;()<>\uE000\uE001])+'

/** `text` with comments dropped and quoted strings put back, unescaped. */
const plain = (text: string, lexed: Lexed): string =>
  text.replace(PLACEHOLDER, (match, index: string) => (match.startsWith(QUOTED) ? (lexed.quoted[Number(index)] ?? '') : ' '))

/**
 * Splits a `Received` header, such as
 * `from helo.example (host.example. [192.0.2.1]) by mx.example with ESMTPS id … for <me@example>; <date>`.
 *
 * The comment directly after the HELO name is where the receiving server
 * records what it saw: the reverse DNS name and the IP, in brackets or bare.
 * Other comments, which can repeat what the sender said (such as its HELO),
 * are ignored when reading the `by` and `for` clauses.
 */
export function parseReceived(value: string): ReceivedHeader {
  const lexed = lex(value)
  // The date follows the first `;` outside comments and quoted strings.
  const clauses = lexed.text.split(';')[0].trim()
  const from = clauses.match(/^from\s+([^\s\uE000\uE001]+)(?:\s*\uE000(\d+)\uE000)?/i)
  const helo = from?.[1] ?? null
  // Anything from `helo=` on (Exim's format) is the sender's claim, not a lookup.
  const comment = from?.[2] !== undefined ? (lexed.comments[Number(from[2])] ?? '').split(/\bhelo=/i)[0] : ''

  let ip: string | null = comment.match(/\[([0-9a-f:.]+|ipv6:[0-9a-f:.]+)\]/i)?.[1] ?? null
  let host: string | null = null
  for (const token of comment.replace(/\[[^\]]*\]/g, ' ').split(/[\s,()]+/).filter(Boolean)) {
    if (isIp(token)) {
      ip ??= token
    } else if (!host && HOSTNAME.test(token)) {
      host = token.replace(/\.$/, '').toLowerCase()
    }
  }

  // The by and for clauses come after the from clause and its comment.
  // Quoted strings stay opaque while the keywords are found; only the chosen
  // values are decoded.
  const rest = dropComments(from ? clauses.slice(from[0].length) : clauses)
  const byToken = rest.match(new RegExp(`(?:^|\\s)by\\s+(${TOKEN})`, 'i'))?.[1]
  const forToken = rest.match(new RegExp(`(?:^|\\s)for\\s+<?(${TOKEN}@${TOKEN})>?`, 'i'))?.[1]
  const by = byToken ? plain(byToken, lexed).toLowerCase() : null
  const forAddress = forToken ? plain(forToken, lexed).toLowerCase() : null

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
 * Comments are dropped and quoted strings are kept whole, so neither can add a
 * result or a property: a `;` or `header.d=` inside a quoted value, such as a
 * sender's quoted local part in `smtp.mailfrom`, stays part of that value.
 */
export function parseAuthResults(value: string): AuthResults {
  const lexed = lex(value)
  const [head = '', ...parts] = dropComments(lexed.text).split(';')
  const authservId = plain(head, lexed).trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const results: AuthResult[] = []
  for (const part of parts) {
    const verdict = part.match(/^\s*([a-z0-9_-]+)\s*=\s*([a-z0-9_-]+)/i)
    if (!verdict) {
      continue
    }
    const props: Record<string, string> = {}
    // Quoted strings are placeholders here, so a key can't be read from inside one.
    for (const prop of part.slice(verdict[0].length).matchAll(new RegExp(`([a-z0-9_-]+\\.[a-z0-9_.-]+)\\s*=\\s*((?:\\uE001\\d+\\uE001|[^\\s;\\uE001])+)`, 'gi'))) {
      props[prop[1].toLowerCase()] = plain(prop[2], lexed)
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
