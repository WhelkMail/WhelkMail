import type { MessageDetail } from '../../../../shared/types'
import type { Env } from '../../../_lib/env'
import { fail, json } from '../../../_lib/http'
import { isSchemaError } from '../../../_lib/schema'
import { loadRaw } from '../../../_lib/mail/load'
import { markMessageSeen } from '../../../_lib/mail/imap'
import { parseImapMessageId } from '../../../_lib/mail/ids'
import {
  attachmentMeta,
  bodyText,
  dateOf,
  parseFull,
  toMailbox,
  toMailboxes,
} from '../../../_lib/mail/parse'

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (typeof value === 'string') {
    return new TextEncoder().encode(value)
  }
  return null
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function inlineCidImages(
  email: Awaited<ReturnType<typeof parseFull>>,
  html: string,
): string {
  const images = new Map<string, string>()
  let total = 0
  for (const attachment of email.attachments ?? []) {
    const contentType = attachment.mimeType ?? ''
    if (!attachment.contentId || !contentType.startsWith('image/')) {
      continue
    }
    const bytes = toBytes(attachment.content)
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) {
      continue
    }
    if (total + bytes.byteLength > 6 * 1024 * 1024) {
      continue
    }
    total += bytes.byteLength
    images.set(
      attachment.contentId.replace(/^<|>$/g, ''),
      `data:${contentType};base64,${bytesToBase64(bytes)}`,
    )
  }
  if (images.size === 0) {
    return html
  }
  return html.replace(/cid:([^"'\s)>]+)/gi, (match, cid: string) => {
    let key = cid
    try {
      key = decodeURIComponent(cid)
    } catch {
      // Keep the raw content id if it is not valid percent-encoding.
    }
    return images.get(key.replace(/[<>]/g, '')) ?? match
  })
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const startedAt = Date.now()
  const loaded = await loadRaw(context.env, id, true)
  if (!loaded) {
    return fail('Message not found', 404, undefined, 'message_not_found')
  }
  const loadDoneAt = Date.now()
  const email = await parseFull(loaded.bytes)
  const text = bodyText(email)
  const attachments = attachmentMeta(email)
  let labelIds: string[] = []
  try {
    const labels = await context.env.DB.prepare(
      'SELECT label_id FROM message_labels WHERE message_id = ?',
    )
      .bind(id)
      .all<{ label_id: string }>()
    labelIds = labels.results.map((row) => row.label_id)
  } catch (error) {
    if (!isSchemaError(error)) {
      throw error
    }
  }
  const detail: MessageDetail = {
    id,
    accountId: loaded.account.id,
    accountEmail: loaded.account.email,
    accountName: loaded.account.display_name,
    folder: loaded.folder,
    from: email.from ? toMailbox(email.from) : { name: null, email: '' },
    to: toMailboxes(email.to),
    cc: toMailboxes(email.cc),
    bcc: toMailboxes(email.bcc),
    subject: email.subject ?? '',
    snippet: text.replace(/\s+/g, ' ').trim().slice(0, 160),
    date: dateOf(email),
    unread: false,
    hasAttachments: attachments.length > 0,
    status: loaded.folder === 'draft' ? 'draft' : 'sent',
    text,
    html: email.html ? inlineCidImages(email, email.html) : null,
    attachments,
    size: loaded.bytes.byteLength,
    labelIds,
  }
  if (loaded.needsSeen) {
    const imapId = parseImapMessageId(id)
    if (imapId) {
      context.waitUntil(
        markMessageSeen(context.env, loaded.account, loaded.folder, imapId.uid).catch(
          () => undefined,
        ),
      )
    }
  }
  console.log(
    `[message] source=${loaded.source} load=${loadDoneAt - startedAt}ms parse=${Date.now() - loadDoneAt}ms size=${loaded.bytes.byteLength}`,
  )
  return json({ message: detail })
}
