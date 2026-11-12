import PostalMime, { type Address, type Email } from 'postal-mime'
import type { AttachmentMeta, Mailbox } from '../../../shared/types'
import { toBase64 } from '../crypto'

export async function parseHeaders(header: string): Promise<Email> {
  return PostalMime.parse(`${header}\r\n\r\n`)
}

export async function parseFull(bytes: Uint8Array): Promise<Email> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return PostalMime.parse(buffer)
}

export function toMailbox(address: Address | undefined): Mailbox {
  return {
    name: address?.name?.trim() ? address.name.trim() : null,
    email: address?.address ?? '',
  }
}

export function toMailboxes(addresses: Address[] | undefined): Mailbox[] {
  return (addresses ?? []).map(toMailbox)
}

export function dateOf(email: Email, fallback = new Date()): string {
  if (!email.date) {
    return fallback.toISOString()
  }
  const parsed = new Date(email.date)
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString()
}

export function bodyText(email: Email): string {
  if (email.text && email.text.trim()) {
    return email.text
  }
  if (email.html) {
    return stripHtml(email.html)
  }
  return ''
}

function toBytes(content: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (typeof content === 'string') {
    return new TextEncoder().encode(content)
  }
  if (content instanceof Uint8Array) {
    return content
  }
  return new Uint8Array(content)
}

export function contentSize(content: string | ArrayBuffer | Uint8Array): number {
  return toBytes(content).byteLength
}

export function contentToBase64(content: string | ArrayBuffer | Uint8Array): string {
  return toBase64(toBytes(content))
}

export function attachmentMeta(email: Email): AttachmentMeta[] {
  return (email.attachments ?? []).map((attachment, index) => ({
    index,
    filename: attachment.filename || `allegato-${index + 1}`,
    contentType: attachment.mimeType || 'application/octet-stream',
    size: contentSize(attachment.content),
    contentId: attachment.contentId?.replace(/^<|>$/g, '') ?? null,
  }))
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Addresses that reveal which of *your* addresses received the message.
 *
 * A domain that only forwards (`EMAIL@DOMAIN.IT` → `EMAIL@PROVIDER.IT`) leaves
 * traces in the headers: the original `To` often survives, and forwarders add
 * `Delivered-To`, `X-Original-To`, `Envelope-To` or a `Received ... for <addr>`.
 * The reply composer uses these to answer from the address the message was
 * actually sent to, like Gmail does with its aliases.
 */
const ALIAS_HEADERS = new Set([
  'delivered-to',
  'x-delivered-to',
  'x-original-to',
  'envelope-to',
  'x-envelope-to',
  'x-forwarded-to',
  'resent-to',
  'apparently-to',
])

const ADDRESS_PATTERN = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

export function aliasAddresses(email: Email): string[] {
  const found = new Set<string>()
  const add = (value: string | null | undefined): void => {
    if (!value) {
      return
    }
    for (const match of value.match(ADDRESS_PATTERN) ?? []) {
      found.add(match.toLowerCase())
    }
  }

  add(email.deliveredTo)
  for (const header of email.headers ?? []) {
    const key = header.key.toLowerCase()
    if (ALIAS_HEADERS.has(key)) {
      add(header.value)
      continue
    }
    if (key === 'received') {
      const forMatch = header.value.match(/for\s+<?([^\s<>;]+@[^\s<>;]+)>?/i)
      if (forMatch) {
        add(forMatch[1])
      }
    }
  }
  return [...found]
}
