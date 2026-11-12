import { toBase64 } from './crypto'

export interface MimeAddress {
  name?: string | null
  email: string
}

export interface MimeAttachment {
  filename: string
  contentType: string
  content: Uint8Array
}

export interface MimeInput {
  from: MimeAddress
  to: MimeAddress[]
  cc: MimeAddress[]
  bcc: MimeAddress[]
  subject: string
  text: string
  html?: string
  attachments: MimeAttachment[]
  messageId: string
  /** Message-ID of the answered message, so replies thread in every client. */
  inReplyTo?: string | null
  /** Full References chain of the answered message. */
  references?: string | null
  date: Date
  includeBcc?: boolean
  headers?: string[]
}

const encoder = new TextEncoder()

function clean(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function encodeWord(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) {
    return value
  }
  return `=?UTF-8?B?${toBase64(encoder.encode(value))}?=`
}

function formatAddress(address: MimeAddress): string {
  const email = clean(address.email)
  const name = address.name ? clean(address.name) : ''
  if (!name) {
    return email
  }
  return `"${encodeWord(name).replace(/(["\\])/g, '\\$1')}" <${email}>`
}

function formatDate(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
}

function wrappedBase64(bytes: Uint8Array): string {
  const encoded = toBase64(bytes)
  const lines: string[] = []
  for (let i = 0; i < encoded.length; i += 76) {
    lines.push(encoded.slice(i, i + 76))
  }
  return lines.join('\r\n')
}

function contentDisposition(filename: string): string {
  const safe = clean(filename).replace(/(["\\])/g, '\\$1')
  const encoded = encodeURIComponent(filename)
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`
}

export function buildMime(input: MimeInput): Uint8Array {
  const mixed = `mix_${crypto.randomUUID()}`
  const alternative = `alt_${crypto.randomUUID()}`
  const headers: string[] = [
    `From: ${formatAddress(input.from)}`,
    `To: ${input.to.map(formatAddress).join(', ')}`,
  ]
  if (input.inReplyTo) {
    headers.push(`In-Reply-To: ${clean(input.inReplyTo)}`)
    const chain = (input.references ?? '').trim()
    headers.push(
      `References: ${clean(chain ? `${chain} ${input.inReplyTo}` : input.inReplyTo)}`,
    )
  }
  if (input.cc.length > 0) {
    headers.push(`Cc: ${input.cc.map(formatAddress).join(', ')}`)
  }
  if (input.includeBcc !== false && input.bcc.length > 0) {
    headers.push(`Bcc: ${input.bcc.map(formatAddress).join(', ')}`)
  }
  headers.push(
    `Subject: ${encodeWord(clean(input.subject))}`,
    `Date: ${formatDate(input.date)}`,
    `Message-ID: ${clean(input.messageId)}`,
  )
  for (const header of input.headers ?? []) {
    const safe = clean(header)
    if (safe) {
      headers.push(safe)
    }
  }
  headers.push('MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${mixed}"`)

  const parts: string[] = []
  const textPart = [
    `--${alternative}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrappedBase64(encoder.encode(input.text || '')),
  ].join('\r\n')

  if (input.html) {
    const htmlPart = [
      `--${alternative}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrappedBase64(encoder.encode(input.html)),
    ].join('\r\n')
    parts.push(
      `--${mixed}`,
      `Content-Type: multipart/alternative; boundary="${alternative}"`,
      '',
      textPart,
      htmlPart,
      `--${alternative}--`,
    )
  } else {
    parts.push(`--${mixed}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrappedBase64(encoder.encode(input.text || '')))
  }

  for (const attachment of input.attachments) {
    const contentType = clean(attachment.contentType) || 'application/octet-stream'
    parts.push(
      `--${mixed}`,
      `Content-Type: ${contentType}; name="${clean(attachment.filename).replace(/(["\\])/g, '\\$1')}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: ${contentDisposition(attachment.filename)}`,
      '',
      wrappedBase64(attachment.content),
    )
  }

  const body = `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n--${mixed}--\r\n`
  return encoder.encode(body)
}

export function snippetOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 160)
}
