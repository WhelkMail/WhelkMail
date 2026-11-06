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
